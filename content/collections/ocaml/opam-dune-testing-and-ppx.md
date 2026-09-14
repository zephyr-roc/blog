---
title: OCaml 工程化：opam、Dune、测试与 PPX
date: 2026-09-14
excerpt: 从 opam switch 和 Dune 项目结构出发，建立库、可执行程序、测试、格式化、文档、PPX 与 CI 的完整工程闭环。
chapter: 工程化
chapterOrder: 10
---

单文件 OCaml 可以用 `utop` 很快验证想法，但生产项目还需要回答：

- 编译器和依赖版本如何隔离；
- 多个 library/executable/test 如何组织；
- 公共模块如何命名；
- 生成代码如何进入编译；
- 测试、格式化和文档如何成为统一构建目标；
- CI 如何重现本地环境；
- 包如何发布并保持元数据一致。

现代 OCaml 的主流答案是 opam 加 Dune。前者管理 compiler switch 与包，后者描述项目构建图。

## opam 管理环境，不只是下载依赖

opam switch 是一套隔离的编译器、库与工具环境。

创建项目本地 switch：

```bash
opam switch create . 5.5.0
eval "$(opam env)"
```

项目目录与 switch 关联后，不同仓库可以使用不同 OCaml 版本和依赖集合。

常见操作：

```bash
opam update
opam install dune ocaml-lsp-server ocamlformat
opam list
opam upgrade
```

`opam update` 更新仓库元数据，`opam upgrade` 才尝试升级已安装包。像 `apt update` 与 `apt upgrade` 一样，二者不是同一个动作。

### switch 不是容器

switch 隔离 OCaml package universe，却仍共享操作系统：

- C compiler 与系统 header；
- OpenSSL、libffi、zlib 等系统库；
- CPU 架构；
- 动态链接器；
- shell 工具。

构建可重现性需要同时记录系统依赖和 opam 选择。容器、Nix 或 CI image 可以补足系统层，但不能把 opam switch 当成完整系统沙箱。

## 项目的最小结构

```text
order_service/
├── dune-project
├── order_service.opam
├── lib/
│   ├── dune
│   ├── order.ml
│   └── order.mli
├── bin/
│   ├── dune
│   └── main.ml
└── test/
    ├── dune
    └── order_test.ml
```

`dune-project` 声明项目：

```lisp
(lang dune 3.17)
(name order_service)
(generate_opam_files true)

(package
 (name order_service)
 (synopsis "Typed order service")
 (depends
  ocaml
  dune))
```

`lang dune` 版本应与团队实际工具链匹配。提高版本意味着可以使用新语法，也意味着旧 Dune 无法读取项目；不能无理由追到最新。

## library stanza

```lisp
(library
 (name order_domain)
 (public_name order_service.domain))
```

目录中的 `.ml` 文件成为 library modules。Dune 默认包装库，调用方通过顶层命名空间访问：

```ocaml
Order_domain.Order.create
```

具体路径取决于 library name、module 文件名与 wrapping 配置。默认 wrapped 行为能避免不同依赖都定义 `Config`、`Util` 后发生全局冲突。

依赖其他库：

```lisp
(library
 (name order_http)
 (public_name order_service.http)
 (libraries
  order_service.domain
  cohttp))
```

Dune 根据模块引用和 stanza 建立构建图，不需要手工排列每个 `.ml` 的编译顺序。

## executable stanza

```lisp
(executable
 (name main)
 (public_name order-service)
 (libraries
  order_service.domain
  order_service.http))
```

`name` 对应入口模块 `main.ml`，`public_name` 是安装后的命令名。

运行：

```bash
dune exec order-service
```

或：

```bash
dune exec ./bin/main.exe
```

项目代码应尽量放入 library，`main.ml` 只负责解析配置、组装依赖、启动 runtime 与映射退出码。这样核心逻辑可以被测试复用，也不会让 executable 成为无法导入的巨大编译单元。

## 开发构建与 release profile

```bash
dune build
dune build --profile release
```

dev profile 通常保留适合开发的检查与调试信息，release profile 面向发布优化。具体 flags 由 Dune 版本和项目配置决定，不应凭 profile 名字猜测所有编译选项。

需要自定义时可以在 `dune` 或 workspace 配置中调整 flags，但应从默认值增量修改，避免覆盖 Dune 已提供的警告与调试选项。

## .ml 与 .mli 的工程角色

`.ml` 是实现，`.mli` 是公开签名。

```ocaml
(* order.mli *)
type t
type error

val create :
  order_no:string ->
  amount:int ->
  (t, error) result

val amount : t -> int
```

接口文件的价值包括：

- 隐藏 record/variant 表示；
- 缩小重编译传播；
- 稳定公共 API；
- 把文档放在调用方真正看到的位置；
- 防止内部辅助函数意外成为承诺。

并非每个内部模块都需要手写 `.mli`。简单、私有、频繁变化的实现可以使用推导接口；公共库和不变量边界应显式签名。

## 测试也是 Dune target

最简单的测试 stanza：

```lisp
(test
 (name order_test)
 (libraries
  order_service.domain
  alcotest))
```

运行：

```bash
dune runtest
```

Dune 会构建测试及依赖，并把测试纳入 alias。CI 不需要逐个记住测试二进制。

### 单元测试：Alcotest

```ocaml
let test_create () =
  match Order.create
          ~order_no:"A-42"
          ~amount:100
  with
  | Error _ ->
      Alcotest.fail
        "expected valid order"
  | Ok order ->
      Alcotest.check
        Alcotest.int
        "amount"
        100
        (Order.amount order)
```

测试重点应是领域行为和公开接口，而不是内部 record 字段。

### 性质测试：QCheck

例子驱动测试检查若干已知输入；property-based testing 生成大量输入验证不变量：

```ocaml
let reverse_twice =
  QCheck.Test.make
    QCheck.(list int)
    (fun values ->
      List.rev (List.rev values)
      = values)
```

适合的性质包括：

- 编解码 round trip；
- 排序结果有序且元素守恒；
- 状态机不产生非法状态；
- 归一化幂等；
- parser/printer 的限定互逆关系。

生成器必须覆盖边界值，否则“一万次随机测试”也可能从未测试空输入、极大值或 Unicode。

### expect 与 cram test

expect test 把输出嵌入源码，适合 parser、formatter、错误信息和编译器工具。输出变化时，diff 会直接显示行为差异。

Dune cram test 以 shell transcript 测 CLI、文件布局和退出码，适合端到端命令行行为。

不要把所有测试都做成 snapshot。业务规则若只比较整段文本，微小格式变化会掩盖真正语义；结构化值应使用结构断言。

## 格式化：ocamlformat

`ocamlformat` 提供统一源码格式。项目通常提交 `.ocamlformat`：

```text
profile=conventional
version=0.27.0
```

版本必须与开发环境一致，因为不同版本可能产生不同格式。实际版本应根据项目锁定，不要直接复制示例。

运行：

```bash
dune fmt
```

CI 可以检查格式化 diff。格式工具的目标是消灭无意义争论，不应在每次工具升级时夹带整库格式变化与业务修改。

## 静态检查与开发工具

常见工具链：

- `ocaml-lsp-server`：编辑器语义服务；
- Merlin：类型、补全、跳转等底层能力；
- `ocamlformat`：格式化；
- Dune RPC/诊断：向编辑器暴露构建状态；
- `odoc`：从签名与注释生成 API 文档；
- `utop`：交互式探索。

编辑器诊断必须与 Dune 实际构建环境一致。最常见的“IDE 报错但命令行能编译”原因是：

- 没有执行正确的 `eval "$(opam env)"`；
- 编辑器未进入项目 switch；
- Dune build context 不同；
- PPX 或生成文件未被语言服务器识别；
- 工作区打开在错误目录。

## odoc：接口即文档入口

在 `.mli` 中使用 odoc 注释：

```ocaml
(** A validated order. *)
type t

(** [create ~order_no ~amount] validates
    input and creates an order. *)
val create :
  order_no:string ->
  amount:int ->
  (t, error) result
```

构建文档：

```bash
dune build @doc
```

好的 API 文档不重复函数名，而应说明：

- 不变量；
- 错误条件；
- 资源所有权；
- 是否执行 I/O；
- 是否可能阻塞；
- 并发安全性；
- 单位、编码与边界值；
- 兼容性承诺。

OCaml 类型很有表达力，但类型不会自动告诉用户时间复杂度、effect 和资源语义。

## PPX：在 AST 层改写代码

PPX preprocessor 接收 OCaml AST，返回改写后的 AST。最常见用途是 deriving：

```ocaml
type user = {
  id : int;
  name : string;
}
[@@deriving show, eq]
```

构建配置：

```lisp
(library
 (name model)
 (preprocess
  (pps
   ppx_deriving.show
   ppx_deriving.eq)))
```

PPX 可以生成 printer、比较、序列化、数据库映射、expect test 支持和 DSL。

### PPX 不是宏文本替换

它处理解析后的语法树，因此比 C macro 更结构化，也能生成带位置信息的 OCaml AST。但它仍会增加：

- 编译时间；
- 依赖耦合；
- 错误信息跳转；
- 升级兼容成本；
- “源码没有出现却实际存在”的 API。

公共领域类型如果通过 PPX 自动生成协议，应确认 schema 稳定性，而不是默认字段一变网络格式也安全变化。

### ppxlib

现代 PPX 通常建立在 ppxlib 提供的兼容层和驱动机制上。自行写 PPX 时，应限制 transformation 范围、保留 source location，并为生成结果和错误消息写测试。

如果普通函数、Functor 或代码生成脚本已经足够，不要为了语法炫技引入 PPX。

## 生成 opam 元数据

Dune 可以从 `dune-project` 生成 opam 文件，减少两份依赖描述漂移：

```lisp
(generate_opam_files true)
```

package stanza 应补充：

- synopsis 与 description；
- source、homepage、bug tracker；
- license；
- depends 与版本约束；
- tags；
- 可选测试/文档依赖。

生成文件是否提交由项目策略决定。无论哪种方式，CI 都应验证生成结果与声明一致。

## 安装项目依赖

在项目根目录：

```bash
opam install . --deps-only --with-test
```

它读取项目包元数据并安装依赖，不安装当前包本身。之后：

```bash
dune build @all
dune runtest
```

若文档也是发布要求，再构建 `@doc`。

开发工具可以放进同一 switch，也可以通过工具专用 switch 管理。选择取决于团队更重视环境简单还是减少工具依赖对解算器的影响。

## 版本约束与锁定

opam 是求解式包管理器：它根据编译器版本、包约束、冲突和系统依赖求出可安装集合。相同宽松约束在不同时间可能得到不同版本。

需要可重现构建时，应明确：

- 支持的 OCaml 版本范围；
- 关键依赖上下界；
- opam repository revision；
- lock file/lock directory 或构建镜像；
- 系统包版本；
- 是否允许安全补丁自动漂移。

锁定并不是永不升级。应让依赖更新成为独立、可测试的变更，而不是在一次业务发布时由解算器偶然发生。

## monorepo 与 workspace

Dune 能在一个 workspace 中管理多个 package、library、executable 和 test。适合共享类型、代码生成器与服务组件。

但单仓库不等于所有模块互相可见。仍应通过 public/private library 和签名维持边界，避免“反正都能引用”形成循环依赖。

可以把架构拆成：

```text
domain      -> 无 I/O 的核心模型
application -> 用例与端口
adapters    -> 数据库、HTTP、消息系统
runtime     -> Eio/Lwt/Async 组装
bin         -> 配置与启动
```

Dune library dependency 应反映这个方向。若 domain 反向依赖 HTTP 或数据库实现，目录再漂亮也没有真正分层。

## CI 的最小闭环

一个可靠流水线至少检查：

1. opam metadata 可解析；
2. 依赖能在声明的 OCaml 版本安装；
3. `dune build @all` 成功；
4. `dune runtest` 成功；
5. `dune fmt` 没有未提交差异；
6. API 文档能生成；
7. 多个支持版本矩阵至少定期运行；
8. 发布包在干净环境可构建；
9. C 系统依赖被明确安装；
10. 缓存不会掩盖缺失依赖。

缓存 opam 与 Dune build artifact 可以显著加速，但 cache key 必须包含 OS、架构、compiler、依赖锁和关键构建配置。

## 发布前检查

opam 包发布前应在隔离环境验证：

- source archive 完整；
- license 与 metadata 正确；
- build/install/remove 流程可用；
- 测试依赖没有混入 runtime depends；
- public modules 与 odoc 符合预期；
- 不依赖仓库外未提交文件；
- 生成代码可重现；
- 最低与最高支持编译器版本通过；
- 安装后可由另一个空项目正常引用。

## 与 Gradle/Kotlin 工程的区别

| 维度 | Kotlin/Gradle | OCaml/opam+Dune |
|---|---|---|
| 编译器隔离 | toolchain/JDK/Gradle 配置 | opam switch |
| 包管理 | Maven repository + Gradle resolution | opam solver |
| 构建描述 | Kotlin/Groovy DSL | Dune S-expression |
| 源集 | module/source set | library/executable/test stanza |
| 代码生成 | KSP/KAPT/compiler plugin | PPX/generator rule |
| API 边界 | visibility、module、interface | library wrapping、.mli/signature |
| 测试任务 | Gradle tasks | Dune aliases/stanzas |
| 格式化 | ktfmt/Spotless | ocamlformat/dune fmt |
| 文档 | Dokka | odoc |
| IDE | IntelliJ 深度整合 | LSP + Merlin + Dune |

Kotlin/Gradle 的生态覆盖面和 IDE 集成更强；Dune 的优势是构建描述相对统一、默认约定集中。复杂 OCaml 工程仍会遇到 C 依赖、PPX 和包解算问题，不能把工具链简洁误解为没有工程成本。

## 一套项目落地顺序

1. 创建项目本地 opam switch；
2. 用 `dune-project` 声明语言和 package；
3. 把核心逻辑放进 library；
4. 用 `.mli` 保护公共不变量；
5. 让 executable 只负责组装；
6. 为单元、性质和 CLI 行为选择合适测试形式；
7. 锁定 ocamlformat 版本；
8. 仅在收益明确时引入 PPX；
9. 用 odoc 补齐 effect、资源与复杂度语义；
10. 让 CI 从干净环境完成 build/test/fmt/doc。

## 结论：工程化的核心是同一张构建图

opam 与 Dune 分别解决环境和构建：

- switch 隔离 compiler/package universe；
- package metadata 描述可解算依赖；
- Dune stanza 建立 library/executable/test 图；
- `.mli` 定义真正公共 API；
- Alcotest、QCheck、expect 与 cram 覆盖不同测试层；
- ocamlformat 固定源代码形状；
- odoc 从接口生成文档；
- PPX 在必要时扩展语法树；
- CI 重放这一整套约束。

工程闭环的标志不是“本机 dune build 能过”，而是任何干净环境都能知道该装什么、构建什么、验证什么和发布什么。

## 下一章

最后一章将覆盖 C FFI、Bigarray、阻塞边界、链接与部署，并回顾 OCaml 适合与不适合的系统，给整套课程建立明确终点。

## 延伸阅读

- [Dune Documentation](https://dune.readthedocs.io/en/stable/)
- [opam Usage](https://opam.ocaml.org/doc/Usage.html)
- [OCaml Platform Tools](https://ocaml.org/docs/platform-tools)
- [odoc Documentation](https://ocaml.github.io/odoc/)
- [ppxlib Documentation](https://ocaml-ppx.github.io/ppxlib/)
