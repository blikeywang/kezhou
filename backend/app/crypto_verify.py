"""加密支付的链上核验:EVM(BNB / Arbitrum,USDC=ERC20)+ Solana(USDC=SPL)。

核验一笔用户提交的 tx_hash:收款地址匹配、代币正确、金额≥应付、确认数达标。
纯核验函数(_check_*)不依赖网络,可离线单测;verify_* 通过各链 JSON-RPC 拉数据。
"""
from __future__ import annotations
import json
import urllib.request


class PendingVerification(Exception):
    """可重试(尚未确认):交易还没上链/确认数不够。20 分钟窗口内前端轮询即可。"""


# ERC-20 Transfer(address,address,uint256) 事件签名 keccak256
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def _rpc(url: str, method: str, params: list, timeout: int = 15):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:      # noqa: S310 (受控 RPC 端点)
        d = json.loads(r.read())
    if d.get("error"):
        raise ValueError(f"rpc error: {d['error']}")
    return d.get("result")


# ---------------- EVM (BNB Chain / Arbitrum) ----------------
def _topic_addr(addr: str) -> str:
    return "0x" + "0" * 24 + addr.lower().replace("0x", "")


def _check_evm_receipt(receipt: dict | None, latest_block: int, token: str,
                       to_addr: str, min_units: int, confirmations: int) -> int:
    """在交易回执里找一条:USDC 合约 -> 收款地址、金额≥min_units 的 Transfer 日志。"""
    if not receipt or receipt.get("blockNumber") in (None, "0x0"):
        raise PendingVerification("tx not found / not mined yet")
    st = str(receipt.get("status")).lower()
    if st not in ("0x1", "1"):
        raise ValueError("tx failed on-chain")
    blk = int(receipt["blockNumber"], 16)
    confs = latest_block - blk + 1
    if confs < confirmations:
        raise PendingVerification(f"waiting confirmations ({confs}/{confirmations})")
    tok, to_topic = token.lower(), _topic_addr(to_addr)
    for log in receipt.get("logs", []):
        if log.get("address", "").lower() != tok:
            continue
        topics = [t.lower() for t in log.get("topics", [])]
        if len(topics) < 3 or topics[0] != TRANSFER_TOPIC or topics[2] != to_topic:
            continue
        amount = int(log.get("data", "0x0"), 16)
        if amount >= min_units:
            return amount
    raise ValueError("no matching USDC transfer to the receiving address")


def verify_evm(rpc: str, tx_hash: str, token: str, to_addr: str,
               min_units: int, confirmations: int) -> int:
    receipt = _rpc(rpc, "eth_getTransactionReceipt", [tx_hash])
    latest = int(_rpc(rpc, "eth_blockNumber", []), 16)
    return _check_evm_receipt(receipt, latest, token, to_addr, min_units, confirmations)


# ---------------- Solana (SPL USDC) ----------------
def _check_solana_tx(tx: dict | None, mint: str, to_owner: str, min_amount_ui: float) -> float:
    """对比收款方 USDC 代币账户的 post-pre 余额增量是否 ≥ 应付。"""
    if not tx:
        raise PendingVerification("tx not found / not finalized yet")
    meta = tx.get("meta") or {}
    if meta.get("err") is not None:
        raise ValueError("tx failed on-chain")

    def _bal(entries):
        out = {}
        for b in entries or []:
            owner = b.get("owner")
            if owner and b.get("mint") == mint:
                out[owner] = float((b.get("uiTokenAmount") or {}).get("uiAmount") or 0)
        return out

    pre, post = _bal(meta.get("preTokenBalances")), _bal(meta.get("postTokenBalances"))
    delta = post.get(to_owner, 0.0) - pre.get(to_owner, 0.0)
    if delta >= min_amount_ui:
        return delta
    raise ValueError("no matching USDC credit to the receiving address")


def verify_solana(rpc: str, tx_hash: str, mint: str, to_owner: str, min_amount_ui: float) -> float:
    tx = _rpc(rpc, "getTransaction",
              [tx_hash, {"encoding": "jsonParsed", "commitment": "finalized",
                         "maxSupportedTransactionVersion": 0}])
    return _check_solana_tx(tx, mint, to_owner, min_amount_ui)


# ---------------- 统一入口 ----------------
def verify_payment(net: dict, tx_hash: str, price_usdc: float) -> None:
    """按网络族核验。net 来自 settings.CRYPTO_NETWORKS[...]。通过则返回,否则抛 ValueError。"""
    if net["family"] == "evm":
        min_units = int(round(price_usdc * (10 ** net["decimals"])))
        verify_evm(net["rpc"], tx_hash, net["token"], net["address"], min_units, net["confirmations"])
    elif net["family"] == "solana":
        verify_solana(net["rpc"], tx_hash, net["mint"], net["address"], price_usdc)
    else:
        raise ValueError("unsupported network family")
