# 统一导航修复

用户在审查后授权直接修复并删除多余测试，要求不运行测试、不做浏览器自动化、不创建 worktree。审查依据是实际源码与用户交互要求；任务审查记录位于本机 `/root/dsh-navigation-review.md`。

共享文件位置声明作为当前标签导航消费者的发布基线，user-files 版本升级到 0.1.9。文档明确同一 opening request 对象贯穿 waterfall；取消、分组历史与焦点由可选 UI 消费者维护。Provider 和 Links 不依赖 sidebar、viewer 或 manager。未改 Host、补丁、Bundle 或远端文件读写逻辑。

验证采用受影响包的 owned build（包含源码类型编译）；不运行测试或浏览器交互。实际构建、激活与发布结果由本机维护 receipt 记录。编译成功不代表交互验收，连续历史快捷键和迟到结果焦点行为仍需人工观察。
