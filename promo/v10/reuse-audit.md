# V10 复用记录

完整检索记录见根目录 `docs/reuse-audit.md` 的 V10 两节。

实际先查完整生态：`site:github.com remotion-dev/remotion video framework`、`site:github.com heygen-com/hyperframes`；再查 `site:github.com yihui-dev/awesome-opus5-5-videos` 与仓库内 muse。

- https://github.com/heygen-com/hyperframes ：沿用本机0.8.36，Apache-2.0，完整HTML时间轴/逐帧视频导出；本次实际导出验证通过。
- https://github.com/remotion-dev/remotion ：参照架构，未接入。已有渲染链满足原组件编译，迁移带来React工程及许可维护成本。未声称适配Remotion。
- https://github.com/greensock/GSAP ：沿用3.15.0与已存许可，负责确定性时间轴，不新写动画引擎。
- https://github.com/yihui-dev/awesome-opus5-5-videos ：API核验main为3d54892e2ae5b0e8d337171e6508bba4cec01ab8，MIT。是案例/提示集合，部分采用物件连续转场、真实UI和克制排版。仓库muse精确搜索没有定位条目，不等于没有执行搜索或仓库无条目。

产品组件与样式直接导入，不复制功能代码。维护依赖哈希见source-manifest.json。React静态输出只保留原DOM，关闭组件内部自动时钟，以原BotEngine确定性采样配合视频时钟。演示夹具不冒充线上执行。

首次抽帧发现遗漏纸张主题、角色本体使用了错误状态、模型近景裁切过紧，均在交付样片前修正。字体使用本机实际PostScript名PingFangSC-Regular；模板自身字体使用已存Noto本地文件，不依赖网络字体。

已完成30秒样片，4—5分钟全功能长片未完成。不能以通过静态/运行检查声明所有产品功能已覆盖。
