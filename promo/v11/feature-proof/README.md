# 本轮新增真实执行证据

`delivery.mjs` 用当前源码执行隔离教师端/教室端服务，不是模拟HTTP成功。使用随机回环端口且关闭局域网发现，不触达真实人员设备。私有目录记录六个连续状态：配对前、发起申请、接受后、完整文件接收、已读回执、WPS启动请求。

`delivery-result.json`：实际签名传输ACK、PPTX哈希、配对、已读和启动结果。启动返回LAUNCH_REQUESTED不证明WPS窗口加载；本轮CUA窗口读取超时/ScreenCaptureKit失败，所以保留未验证标记，不纳入成功画面。

影片重放使用真实状态与原客户端normalizeSnapshot、PairingCard、InboxCard，见../delivery-chapter。网络和WPS由本脚本实际调用；原始密钥及快照不提交Git，不向外部人员发送信息。新的执行与已有模型协作历史严格区分。

## A2A 与学生流转（2026-10-02新增）

`a2a.mjs` 在确认为demo的49340后台，使用原mochi-dispatch工具与独立SQLite保存真实问询、委托、寻物和回应。结果见a2a-result.json。最后的COMPLETED表示这一轮应答结束，不表示找到了物品或修改了试题。

`movement.mjs` 使用原mochi-campus工具，演示学生DEMO003陈言蹊，班主任和宿舍工作人员按各自身份操作，最终CLOSED，四条流转事件齐全。审批输入是用户授权的演示脚本决定，不是人类点击录屏。使用演示账号和虚拟学生，没有真实人员通讯。构建影片必须复用已保存数据，不为重新渲染而反复新建申请。

此前DEMO007叶知夏已经OUTBOUND；旧录像的待审批标签只代表历史拍摄时刻，不是当前状态。不能对已经放行的人重复申请。
