# Runner 大盘复盘增量计划

基于已批准的 [本地 Runner 云端方案](../../deployment/vercel-supabase-plan.md)，本轮接入单市场大盘复盘。保留原 CLI/API/桌面端，正式站点与历史数据不切换、不删除。

## 实施范围

1. 新增迁移扩展 `execution_tasks.task_type` 和提交 RPC，支持 `market_review`，输入仅 `{region}`，允许 cn/hk/us/jp/kr 单市场；原已应用迁移不改动。
2. Vercel API 与浏览器沿用同一任务链路；新增任务类型及复盘市场选择，离线/未知/忙碌仍拒绝，重复提交保持同一请求和输入。
3. Runner 复用 `build_market_review_runtime` 与 `run_market_review`；关闭本地报告文件和通知，持久化后校验 `MARKET`/`market_review` 历史存在。沿用原发布包、租约和原子提交。
4. 使用既有诊断识别模型生成是否成功；模板降级明确标注，不将模板等同于模型成功。先不允许多市场合并，避免原引擎忽略空子报告产生不明确部分成功。
5. 验证输入/权限/幂等/离线协议、新适配器与真实历史保存、前端行为和旧入口回归；隔离测试不读取真实 `.env` 或原历史库。
6. 测试通过后在恢复 Supabase 与 Vercel Preview 联调一次真实复盘，验证新进程可读历史、附件可下载、停止 Runner 不可新建任务。保留远端样本与仓库外截图。

## 不在本轮范围

综合分析、问股、选股、回测、Actions 日报、旧 SQLite 导入、生产切换。现有本地多市场功能保持原契约。

## 回滚

停止 Runner，回退 Vercel 到单股版或报告阅读版；保留新增执行记录与报告。不要通过删除历史或回改已应用迁移回滚。

## 验收

具体执行结果记录到 `docs/deployment/local-runner-validation.md`，区分本地确定性验证、真实远端验证与未验证项；不以构建成功替代实际请求。
