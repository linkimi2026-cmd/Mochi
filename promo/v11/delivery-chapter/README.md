# 双端课件投递（新增实测证据）

使用 `feature-proof/delivery.mjs` 调用当前产品 MochiLanService，在独立数据目录、随机回环端口进行真实签名传输。没有替换网络实现或注入假成功。依次保存双方确认配对、文件完整接收、通知ACK、已读与回执的真实状态。产品发出WPS打开请求，但窗口采集失败，因此不声称已经看到幻灯片加载。

影片用原生 PairingCard、InboxCard 和 normalizeSnapshot 渲染这批状态，16秒历史状态重放；不是新录屏。投递文件为前面实际生成的六页PPTX，文件哈希与原成果一致。后期PPTX小卡是传输引导道具，不是新产品UI。配对临时代码为已停止监听的隔离实例历史值；身份私钥、签名、公钥不进入画面资产。Git忽略全部数据与媒体。

`delivery.mjs` 会发起新一次隔离传输并请求WPS打开；不要仅为了重渲染重复运行。复用现存delivery-result.json构建本章即可。

1. `node promo/v11/delivery-chapter/build.mjs`
2. HyperFrames check本章，检查runtime与lint；对MP4实际抽帧，不能把检查红框入片。
3. HyperFrames render为`output/delivery-fixed.mp4`，2K120。
4. `node promo/v11/delivery-chapter/join-teaching.mjs`，拼接前22秒真实成果与16秒投递。
5. `motion-pass/build.mjs --bridge=2` 更新出场素材，render2，再assemble刷新body2与全部改速转场。

复用：沿用本轮已检索的HyperFrames0.8.36/GSAP3.15.0与现有原组件，不新增依赖或重写产品卡片。实际运行证据见 `../feature-proof/delivery-result.json`。
