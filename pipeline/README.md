# pipeline — 生成脚本与算法蓝本

这些脚本从 `../data/*.json`(已算好的匹配结果)出发,生成图表与前端原型。它们同时是**后端匹配引擎的可读蓝本**——生产实现请参照 `../docs/BUILD_SPEC.md §2` 精确复刻。

## 依赖
```
pip install matplotlib numpy
```

## 运行顺序
```
python appdata.py        # ../data/*.json + charts_slate.json -> appdata.json(前端数据+双语判断/季节性/形态)
python charts_slate.py   # 灰蓝主题图表(深/浅两套)-> charts_slate.json
python app.py            # 拼装 -> app.html(含 i18n 词典 T,128 条中英)
python report3.py        # 生成统一分析报告 -> report.html
```
注:`appdata.py` 依赖 `charts_slate.json`,首次请先跑 `charts_slate.py`。

## 关键文件
- `appdata.py` — 数据汇编;`morph()` 形态拆解、`verdict()` 方向判断、`sig()` 二项显著性、双语名称。
- `charts_slate.py` — 每标的三面板图(形态+投影 / 上涨概率 / 季节性)+ 战场热力图,灰蓝深/浅。
- `app.py` — 前端 SPA 模板 + i18n 词典 `T`(可直接导出为 i18next 资源)。
- `report2.py` / `charts2.py` — 早期"深色仪表盘 + 浅色杂志"双版报告(历史留存)。

## 数据源提醒
`data/*.json` 由 Binance(加密 4h/日)与 Yahoo(美股/大宗 日/周,复权)抓取计算而来,仅供原型。商用请换正规数据商。抓取坑见 `../docs/BUILD_SPEC.md §3.1`。
