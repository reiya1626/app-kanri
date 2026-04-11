# 現在の主導線

## 教員環境
- `app/page.tsx`
- 問題文と回答例をアップロードする
- `problem-config.tsx` を通して保存する

## 学習環境
- `app/main/page.tsx`
- 保存された問題文を読み込んで表示する
- 学習者がオブジェクト図を入力する
- クラス図変換や編集へ進む

## 学習環境が使うAPI
- `app/api/convert-object-to-class/route.ts`
- オブジェクト図からクラス図情報を生成する

# 今回の整理対象

- `app/page.tsx`
- `app/main/page.tsx`
- `components/config/problem-config.tsx`
- 新規作成する `types/problem.ts`

# 今回はまだ大きく触らないもの

- `app/api/convert-object-to-class/route.ts` の仕様
- `app/main/class-editor/page.tsx`
- `app/api/scenarios/...`
- `sub`, `wo` 配下のページ

# 現状確認結果

- 教員画面で問題文入力は可能
- 教員画面で回答例入力は可能
- 学習画面で問題文は読める
- 変換機能の入口は存在する

## 今回の方針
- 整理対象は `app/page.tsx` と `app/main/page.tsx` を中心にする
- 変換APIの仕様はこの段階では変えない
- まず問題データの型を確定する

# 問題データ方針

- 今は複数問題対応をしない
- 今扱うのは `currentProblem` 1件だけ
- 教員環境と学習環境は `ProblemData` を共有する
- 保存単位は `ProblemStore` とする
- この段階では localStorage ベースを維持する

# 現在の値と ProblemData の対応

- `objectProblemText` → `ProblemData.objectProblemText`
- `objectAnswerPuml` → `ProblemData.objectAnswerPuml`
- `classProblemText` → `ProblemData.classProblemText`
- `classAnswerPuml` → `ProblemData.classAnswerPuml`

追加で必要なもの:
- `id`
- `title`
- `updatedAt`

# ProblemData の初期運用ルール

- `id` は当面 `"current"` でよい
- `title` は未入力なら `"無題"` とする
- `updatedAt` は保存時に `new Date().toISOString()` を入れる

# Step 3での教員画面の責務

- 問題文を入力またはアップロードする
- 回答例を入力またはアップロードする
- 保存前に最低限の妥当性確認をする
- `ProblemData` として保存する
- 学習画面 `/main` へ進める