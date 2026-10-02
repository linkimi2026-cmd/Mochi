# 本轮新增真实执行证据

`delivery.mjs` 用当前源码执行隔离教师端/教室端服务，不是模拟HTTP成功。使用随机回环端口且关闭局域网发现，不触达真实人员设备。私有目录记录六个连续状态：配对前、发起申请、接受后、完整文件接收、已读回执、WPS启动请求。

`delivery-result.json`：实际签名传输ACK、PPTX哈希、配对、已读和启动结果。启动返回LAUNCH_REQUESTED不证明WPS窗口加载；本轮CUA窗口读取超时/ScreenCaptureKit失败，所以保留未验证标记，不纳入成功画面。

影片重放使用真实状态与原客户端normalizeSnapshot、PairingCard、InboxCard，见../delivery-chapter。网络和WPS由本脚本实际调用；原始密钥及快照不提交Git，不向外部人员发送信息。新的执行与已有模型协作历史严格区分。
