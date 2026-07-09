# -*- coding: utf-8 -*-
import json, io, base64
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

CP=json.load(open("crypto_payload.json")); CS=json.load(open("crypto_season.json"))
SP=json.load(open("stock_payload.json")); COM=json.load(open("commodities_payload.json"))

CH_H=[6,30,60,90,180]; CH_L={6:"1d",30:"5d",60:"10d",90:"15d",180:"30d"}
ST_H=[5,10,21,42,63]; ST_L={5:"1w",10:"2w",21:"1m",42:"2m",63:"3m"}

GROUPS={
 "crypto":[("BTC",CP["PRIM"]["BTC"],CS["BTC"]),("ETH",CP["PRIM"]["ETH"],CS["ETH"]),("SOL",CP["PRIM"]["SOL"],CS["SOL"])],
 "stock":[(k,SP["PRIM"][k],SP["SEASON"][k]) for k in ["AAPL","NVDA","SPY","QQQ","DJI","IXIC"]],
 "commodity":[(k,COM["PRIM"][k],COM["SEASON"][k]) for k in ["GLD","USO","SLV"]],
}
HORIZ={"crypto":(CH_H,CH_L),"stock":(ST_H,ST_L),"commodity":(ST_H,ST_L)}

T={
 "dark":dict(bg="#141b26",fg="#dbe2ee",mut="#8695ab",grid="#293546",cur="#e2e8f2",
             corr="#5b9bd5",dtw="#9aa8c9",base="#48566b",up="#54b98a",dn="#e07a7a",cmap="RdYlGn"),
 "light":dict(bg="#f3f5f9",fg="#28303e",mut="#7c8798",grid="#d7dde7",cur="#28303e",
             corr="#3b6fb0",dtw="#7885a6",base="#aeb8c8",up="#2f9e74",dn="#cf6060",cmap="RdYlGn"),
}
def b64(fig,th):
    bio=io.BytesIO(); fig.savefig(bio,format="png",dpi=118,bbox_inches="tight",facecolor=th["bg"]); plt.close(fig)
    return "data:image/png;base64,"+base64.b64encode(bio.getvalue()).decode()
def style(th):
    plt.rcParams.update({"font.size":8.5,"text.color":th["fg"],"axes.labelcolor":th["fg"],
      "xtick.color":th["mut"],"ytick.color":th["mut"],"axes.edgecolor":th["grid"],"axes.facecolor":th["bg"],
      "figure.facecolor":th["bg"],"axes.grid":True,"grid.color":th["grid"],"grid.alpha":0.55,"axes.titlecolor":th["fg"]})

def asset_fig(name,P,season,H,HL,th):
    style(th); fig,axs=plt.subplots(1,3,figsize=(13.4,3.25))
    nc=P["nc"]; W=len(nc)
    ax=axs[0]; ax.plot(range(W),nc,color=th["cur"],lw=1.7,label="current",zorder=5)
    for mp,cl,lb in [(P["mpC"],th["corr"],"corr proj"),(P["mpD"],th["dtw"],"DTW proj")]:
        base=nc[-1]; proj=[base*m/100 for m in mp]; xp=list(range(W-1,W-1+len(proj)))
        ax.plot(xp,proj,color=cl,lw=1.6,label=lb)
    ax.axvline(W-1,color=th["mut"],ls=":",lw=.8)
    ax.set_title(f"{name} · pattern + projection",fontsize=9,loc="left"); ax.legend(fontsize=6.5,frameon=False,loc="upper left"); ax.set_xlabel("bars")
    ax=axs[1]; xs=np.arange(len(H)); w=0.26
    cc=[P["condC"][i][1] for i in range(len(H))]; cd=[P["condD"][i][1] for i in range(len(H))]; bb=[P["bas"][i][1] for i in range(len(H))]
    ax.bar(xs-w,[v*100 for v in cc],w,color=th["corr"],label="corr")
    ax.bar(xs,[v*100 for v in cd],w,color=th["dtw"],label="DTW")
    ax.bar(xs+w,[v*100 for v in bb],w,color=th["base"],label="baseline")
    ax.axhline(50,color=th["fg"],lw=.6,ls=":")
    ax.set_xticks(xs); ax.set_xticklabels([HL[h] for h in H]); ax.set_ylabel("P(up) %")
    ax.set_title(f"{name} · up-probability",fontsize=9,loc="left"); ax.legend(fontsize=6.5,frameon=False)
    ax=axs[2]; yrs=[r[0] for r in season["py"]]; vals=[(r[3] if r[3] is not None else 0)*100 for r in season["py"]]
    ax.bar(range(len(yrs)),vals,color=[th["up"] if v>=0 else th["dn"] for v in vals])
    ax.axhline(0,color=th["fg"],lw=.6); ax.set_xticks(range(len(yrs))); ax.set_xticklabels([str(y)[2:] for y in yrs],fontsize=6.5)
    ax.set_ylabel("return %"); ax.set_title(f"{name} · same-date forward, by year",fontsize=9,loc="left")
    fig.tight_layout(); return b64(fig,th)

def edge_fig(group,th):
    style(th); items=GROUPS[group]; H,HL=HORIZ[group]
    labels=[]; rows=[]
    for name,P,se in items:
        c=P["condC"]; b=P["bas"]
        rows.append([(c[0][1]-b[0][1])*100,(c[2][1]-b[2][1])*100,(c[4][1]-b[4][1])*100]); labels.append(name)
    g=np.array(rows); fig,ax=plt.subplots(figsize=(5.6,0.62*len(labels)+1.2))
    im=ax.imshow(g,cmap=th["cmap"],vmin=-16,vmax=16,aspect="auto")
    ax.set_yticks(range(len(labels))); ax.set_yticklabels(labels)
    ax.set_xticks(range(3)); ax.set_xticklabels(["near","mid","far"])
    for i in range(len(labels)):
        for j in range(3): ax.text(j,i,f"{g[i,j]:+.0f}",ha="center",va="center",fontsize=9,color="#10161f")
    ax.set_title("matched P(up) − baseline (pp)",fontsize=9.5,loc="left",pad=6)
    cb=fig.colorbar(im,ax=ax,shrink=.8); cb.ax.tick_params(colors=th["mut"])
    fig.tight_layout(); return b64(fig,th)

OUT={}
for theme in ["dark","light"]:
    th=T[theme]; d={}
    for group,items in GROUPS.items():
        H,HL=HORIZ[group]
        for name,P,se in items: d[name]=asset_fig(name,P,se,H,HL,th)
        d["EDGE_"+group]=edge_fig(group,th)
    OUT[theme]=d
json.dump(OUT,open("charts_slate.json","w"))
print("ok",{t:len(OUT[t]) for t in OUT})
