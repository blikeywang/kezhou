# -*- coding: utf-8 -*-
import json, io, base64, math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

CP=json.load(open("crypto_payload.json")); CS=json.load(open("crypto_season.json"))
SP=json.load(open("stock_payload.json"))

# ---- asset registry ----
# each: (display, group, primary dict, season dict, horizons, hlabels, season_far_idx)
CRYPTO_H=[6,30,60,90,180]; CRYPTO_HL={6:"1d",30:"5d",60:"10d",90:"15d",180:"30d"}
STOCK_H=[5,10,21,42,63]; STOCK_HL={5:"1w",10:"2w",21:"1m",42:"2m",63:"3m"}

ASSETS=[]
for k in ["BTC","ETH","SOL"]:
    ASSETS.append((k,"crypto",CP["PRIM"][k],CS[k],CRYPTO_H,CRYPTO_HL,3))
for k in ["AAPL","NVDA","SPY","QQQ","DJI","IXIC"]:
    ASSETS.append((k,"stock",SP["PRIM"][k],SP["SEASON"][k],STOCK_H,STOCK_HL,3))

THEMES={
 "dark":dict(bg="#0b1020",fg="#e6ebf5",mut="#8595b3",grid="#243049",
             cur="#e6ebf5",corr="#22d3ee",dtw="#a78bfa",base="#5b6b8c",
             up="#34d399",dn="#fb7185",cmap="RdYlGn"),
 "light":dict(bg="#ffffff",fg="#1f2433",mut="#8a8f9c",grid="#e7e3da",
             cur="#1f2433",corr="#4f46e5",dtw="#c2410c",base="#b8bdc9",
             up="#059669",dn="#dc2626",cmap="RdYlGn"),
}

def b64(fig,T):
    bio=io.BytesIO(); fig.savefig(bio,format="png",dpi=115,bbox_inches="tight",
        facecolor=T["bg"]); plt.close(fig)
    return "data:image/png;base64,"+base64.b64encode(bio.getvalue()).decode()

def style(T):
    plt.rcParams.update({"font.size":8.5,"text.color":T["fg"],"axes.labelcolor":T["fg"],
      "xtick.color":T["mut"],"ytick.color":T["mut"],"axes.edgecolor":T["grid"],
      "axes.facecolor":T["bg"],"figure.facecolor":T["bg"],"axes.grid":True,
      "grid.color":T["grid"],"grid.alpha":0.5,"axes.titlecolor":T["fg"]})

def asset_fig(name,P,season,H,HL,sidx,T):
    style(T)
    fig,axs=plt.subplots(1,3,figsize=(13.6,3.3))
    nc=P["nc"]; W=len(nc)
    ax=axs[0]
    ax.plot(range(W),nc,color=T["cur"],lw=1.7,label="current",zorder=5)
    for mp,cl,lb in [(P["mpC"],T["corr"],"corr proj"),(P["mpD"],T["dtw"],"DTW proj")]:
        base=nc[-1]; proj=[base*m/100 for m in mp]
        xp=list(range(W-1,W-1+len(proj)))
        ax.plot(xp,proj,color=cl,lw=1.6,label=lb)
    ax.axvline(W-1,color=T["mut"],ls=":",lw=.8)
    ax.set_title(f"{name} · pattern + projection",fontsize=9,loc="left")
    ax.legend(fontsize=6.5,frameon=False,loc="upper left")
    # panel 2: pUp bars corr/dtw/base
    ax=axs[1]; xs=np.arange(len(H)); w=0.26
    cc=[P["condC"][i][1] for i in range(len(H))]
    cd=[P["condD"][i][1] for i in range(len(H))]
    bb=[P["bas"][i][1] for i in range(len(H))]
    ax.bar(xs-w,[v*100 for v in cc],w,color=T["corr"],label="corr")
    ax.bar(xs,[v*100 for v in cd],w,color=T["dtw"],label="DTW")
    ax.bar(xs+w,[v*100 for v in bb],w,color=T["base"],label="baseline")
    ax.axhline(50,color=T["fg"],lw=.6,ls=":")
    ax.set_xticks(xs); ax.set_xticklabels([HL[h] for h in H]); ax.set_ylabel("P(up) %")
    ax.set_title(f"{name} · up-probability",fontsize=9,loc="left"); ax.legend(fontsize=6.5,frameon=False)
    # panel 3 seasonality
    ax=axs[2]
    yrs=[r[0] for r in season["py"]]; vals=[ (r[sidx] if r[sidx] is not None else 0)*100 for r in season["py"]]
    cols=[T["up"] if v>=0 else T["dn"] for v in vals]
    ax.bar(range(len(yrs)),vals,color=cols)
    ax.axhline(0,color=T["fg"],lw=.6)
    ax.set_xticks(range(len(yrs))); ax.set_xticklabels([str(y)[2:] for y in yrs],fontsize=6.5,rotation=0)
    ax.set_ylabel("return %"); ax.set_title(f"{name} · same-date forward, by year",fontsize=9,loc="left")
    fig.tight_layout()
    return b64(fig,T)

def edge_fig(T):
    style(T)
    rows=[]; labels=[]
    for name,grp,P,season,H,HL,si in ASSETS:
        if grp=="crypto": M=CP["MATRIX"][ ({"BTC":"BTCUSDT","ETH":"ETHUSDT","SOL":"SOLUSDT"}[name])+"_4h_60"]
        else: M=SP["MATRIX"][name+"_1d_40"]
        e=[ (M["corr"][0]-M["bas"][0])*100, (M["corr"][2]-M["bas"][1])*100, (M["corr"][4]-M["bas"][2])*100 ]
        rows.append(e); labels.append(name)
    g=np.array(rows)
    fig,ax=plt.subplots(figsize=(7.6,4.2))
    im=ax.imshow(g,cmap=T["cmap"],vmin=-18,vmax=18,aspect="auto")
    ax.set_yticks(range(len(labels))); ax.set_yticklabels(labels)
    ax.set_xticks(range(3)); ax.set_xticklabels(["near","mid","far"])
    for i in range(len(labels)):
        for j in range(3):
            ax.text(j,i,f"{g[i,j]:+.0f}",ha="center",va="center",fontsize=8.5,
                    color="#0b1020")
    ax.set_title("Matched P(up) minus baseline  (pp)",fontsize=10,loc="left",pad=8)
    cb=fig.colorbar(im,ax=ax,shrink=.85); cb.ax.tick_params(colors=T["mut"])
    fig.tight_layout()
    return b64(fig,T)

def build_charts(theme):
    T=THEMES[theme]; CH={}
    for name,grp,P,season,H,HL,si in ASSETS:
        CH[name]=asset_fig(name,P,season,H,HL,si,T)
    CH["EDGE"]=edge_fig(T)
    return CH

if __name__=="__main__":
    out={t:build_charts(t) for t in ["dark","light"]}
    json.dump(out,open("charts2.json","w"))
    print("ok",{t:len(out[t]) for t in out})
