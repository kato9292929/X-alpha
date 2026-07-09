# X-alpha

X（Twitter）の alpha 投稿を「日付つき・反証可能な主張」として記録し、判定日後に一次データで採点するパイプライン。Claude Portfolio（osd）と同じ型の **逃げない記録（reputation層）** を作り、osd との **食い違い（divergence）** を抽出することが目的。集めることが目的ではない。

取り込みは公式 X API（OAuth 2.0 App-Only / Bearer）で、**公開 X リストのツイート**（`GET /2/lists/:id/tweets`）のみを対象にする。**スクレイピングはしない。** ユーザー認可フロー・スコープ・refresh token ローテーションは不要（Bearer は失効・消費の概念がない）。

## 大原則（コードでも守っている）

- **原文を再配布しない。** 保存するのは tweet ID・author・投稿日時と、Claude が自分の言葉に要約した構造化主張だけ。生テキストは抽出の入力としてメモリ上に留め、記録ファイル・公開出力に一切残さない（`.gitignore` でダンプ流出も防止）。
- **発信者に中立。** 記録は「日付 D の主張 X → 結果 Y」という事実のみ。評価・断罪の語を入れない。
- **追記のみ（append-only）。** `data/*.jsonl` は追記だけ。過去行を書き換え・削除しない。`tweet_id` で重複取り込みを防ぐ。
- **osd 本体に触らない。** divergence は osd 公開 API を HTTP GET で読むだけ。

## パイプライン

| Phase | 入口 | 役割 | 出力（append-only） |
|---|---|---|---|
| 1 取り込み | `npm run ingest` | X リストのツイートを取得（ページング対応、既知の最新 tweet_id で打ち切り）、最小の生データを記録 | `data/tweets-raw.jsonl` |
| 2 抽出 | `npm run pipeline` | 本文を Claude に渡し構造化主張を生成 → 反証可能性フィルタ → 追記 | `data/claims-history.jsonl` |
| 3 採点 | `npm run score` | 判定窓を過ぎた scorable 主張を一次データで hit/miss/partial 判定、reputation 集計 | `data/scores-history.jsonl`, `data/reputation-history.jsonl` |
| 4 divergence | `npm run divergence` | osd 保有（=ロング）と X 主張の方向を ticker 一致で突き合わせ | `data/divergence-history.jsonl`, `data/divergence-latest.json` |

Phase 2 は Phase 1 と本文の受け渡しをメモリ内で行う統合ランナー（`src/extract/runPipeline.ts`）。本文がディスクに落ちない設計のため、抽出は取り込みと同じ実行内で完結する。

## 主張スキーマ（`data/claims-history.jsonl` の 1 行）

```jsonc
{
  "source": "x",
  "tweet_id": "...", "author_handle": "...", "author_id": "...",
  "posted_at": "ISO", "captured_at": "ISO",
  "scorable": true,
  "claim": {
    "assets": ["NVDA"], "direction": "up",
    "thesis": "自分の言葉での要約（原文コピー禁止）",
    "condition": "反証条件", "judgment_date": "YYYY-MM-DD|null", "horizon": "3m|null"
  },
  "tags": ["..."], "unscored_reason": null
}
```

**反証可能性フィルタ**（`src/extract/falsifiability.ts`）: `assets` + 解決可能な `direction` + `condition` + 判定窓（`judgment_date` か `horizon`）が揃うものだけ `scorable=true`。揃わないものは `scorable=false` で `tags` と `unscored_reason` を付け、未採点のまま残す。`scorable` はモデルの自己申告を信用せず、こちらで構造から再判定する。

## 採点（Phase 3）

- 価格方向系（`up/down/long/short`）: 投稿日→判定日のリターンで hit/miss/partial（partial は ±2% のデッドゾーン、`X_ALPHA_BAND` で調整）。
- 相対系（`outperform/underperform`）: ベンチマーク（US=`SPY`, JP=`1306.T`）比。
- **複雑な数値条件（受注残・ガイダンス等）は自動採点しない。** `tags` に `fundamental`/`complex_condition` 等があれば `review_pending`（LLM補助＋人手レビュー待ち）として残し、hit/miss を付けない。
- 価格ソースはプラガブル（`src/score/priceSource.ts`）。既定は無料・キー不要の **stooq**。`fixture` はオフライン検証用。
- reputation は発信者ごとに hit/miss/partial を集計（partial=0.5、review/undetermined は率から除外）。

## divergence（Phase 4）

osd 保有はロング。X 主張が同一 ticker に対して弱気（`down/short/underperform`）のとき divergence として抽出。判定窓を過ぎ、その主張のスコアがあれば、実現リターンから **X 側・osd 側どちらが当たったか** を併記する。v0 は ticker 完全一致のみ。テーマレベルの突き合わせは v1。

## 必要な secret / env

`.env.example` を参照。値は Katomasa が投入（コードにハードコードしない）。

| env | Phase | 用途 |
|---|---|---|
| `X_BEARER_TOKEN` | 1 | X App-Only Bearer token（Developer Console > Keys and Tokens）。スコープ・認可不要、失効・ローテートなし |
| `X_LIST_ID` | 1 | 取り込む公開 X リストの数値 id（リスト URL 末尾の数字） |
| `X_MAX_PAGES_PER_RUN` | 1 | 1 実行あたりの最大ページ数（1 ページ=100件、既定 3=最大300件） |
| `ANTHROPIC_API_KEY`（+ `X_ALPHA_ANTHROPIC_MODEL`） | 2 | 主張抽出（既定モデル `claude-sonnet-5`） |
| `X_ALPHA_PRICE_SOURCE` | 3 | `stooq`(既定) / `fixture` |
| `OSD_US_PORTFOLIO_URL`, `OSD_JP_PORTFOLIO_URL` | 4 | osd 公開 API（既定値あり） |

### 取り込み（App-Only Bearer + X リスト）

`GET /2/lists/:id/tweets` は OAuth 2.0 App-Only（Bearer）対応で、**スコープ・ユーザー認可フロー・refresh token ローテーションが一切不要**。Rate limit は Per App 900/15min で、1 日 1 回の取り込みには十分。

- 認証はヘッダー `Authorization: Bearer ${X_BEARER_TOKEN}` のみ（`src/ingest/xClient.ts`）。
- ページングは `meta.next_token` を辿るが、次のいずれかで**打ち切る**（どちらもエラーでなく正常終了）：
  - **保存済み JSONL の最新 tweet_id 以下に達したとき**（since 打ち切り。リストは新しい順に返るため。重複保存の防止と read 数節約を兼ねる）、
  - **1 実行あたりの最大ページ数（`X_MAX_PAGES_PER_RUN`、既定 3）に達したとき**。初回で since 打ち切りが効かないときに全量を遡らないためのガード。残りは翌日以降の実行が since 打ち切りで差分として拾う。
- 各リクエストに **30 秒のタイムアウト**（無限待ち禁止。タイムアウト時はステータス不明としてエラー終了）。
- **進捗ログ**を stdout に出す：取り込みは 1 ページごとに「ページ n／取得 m 件／最古 tweet_id と日時」、抽出段は 1 件ごとに処理件数。長時間無言にならない。
- 保存フィールドは tweet_id / author(username) / created_at / captured_at のみ。**ツイート原文はディスクに残さない**（抽出への受け渡しはメモリ内）。

### ライブ検証手順（Katomasa が実施）

この環境（クラウド側）は `api.x.com` へ到達できないため、ライブ実行は GitHub Actions 側で行う。`workflow_dispatch` の手動実行が必要（Claude Code のトークンでは 403 になる）。

1. **プラン確認**: developer.x.com の Developer Console でアプリのプランを確認（legacy Free / legacy Basic / pay-per-use のどれか）。pay-per-use は read が **$0.005/post・24 時間デデュープ・月 200 万 read 上限**。**legacy Free は read 不可の可能性がある**ため、その場合は結果を報告して止まる。
2. **Bearer 投入**: 同 Console の Keys and Tokens から Bearer Token を取得し、`gh secret set X_BEARER_TOKEN` で投入。
3. **リスト作成 + 投入**: X でアルファ垢の**公開リスト**を作成し、リスト URL 末尾の数字（リスト id）を `gh secret set X_LIST_ID` で投入。
4. **手動実行**: pipeline workflow を `workflow_dispatch` で実行。
5. **成功条件**: 取り込みが完走し、`data/claims-history.jsonl` に新規レコードが append され、**旧 token 系のエラーが一切出ないこと**。

> エラー時は原因を推測で断定せず、レスポンスの**ステータスコードとボディを丸ごと**ログに出す設計（`src/ingest/xClient.ts` の `defaultFetchPage`）。

## x402 エンドポイント（Solana leg / §6実測402準拠）

scorable 主張＋発信者実績を、AA が discover→402→pay→200 で消費できる x402 エンドポイントとして公開する。serve 先は **Vercel**（`api/` に serverless functions を追加、`data/*.jsonl` を同リポジトリから読む。パイプライン部分＝GitHub Actions は不変更）。理由：既存が Node/TS 構成で serverless 基盤が無く、最小追加で済むため。

| パス | 課金 | 内容 |
|---|---|---|
| `GET /claims` | 無償 | discover 用メタ：アクティブ主張数・資産別件数・データ鮮度・発信者数・`_hint`（機械可読：`/claims/active`, 単価, payTo, network） |
| `GET /claims/active` | x402 有償 | 402 は §6 実測形に準拠。支払い後に構造化主張＋`author_weight`＋`aggregate.by_asset` を返す |

- **402 transport（§6）**：requirements は `PAYMENT-REQUIRED` ヘッダーに base64、ボディは `{}`（空402ではない）。
- **accepts は静的自前構築**（facilitator の `getSupported` に非依存＝到達性非依存で常に非空。OSD 7/1 regression の回避）。**v1 leg（`network:"solana"`）＋ v2 leg（CAIP-2）を併記**（現行 AA は v2 のみだと弾くため）。
- 各 leg：`scheme:"exact"`, `amount:"10000"`（atomic USDC 6桁）, `asset`(Solana USDC mint), `payTo`, `extra:{resource, feePayer}`。
- **feePayer だけは動的**（PayAI がローテートする：D6Zht…→BFK9…→2wKup…。静的に焼くと死ぬ）。PayAI `/supported` から取得し短時間キャッシュ、到達不能時は fallback（`X402_FEE_PAYER`／既知の最新値）を使い、**feePayer が取れなくても accepts は空にしない**（§6 regression を feePayer で再発させない）。network/amount/asset/payTo/transport は §6 どおり静的自前構築のまま。
- **決済実行は自前化しない（§1）**：`PAYMENT-SIGNATURE` を PayAI facilitator に渡して verify→settle。成功時のみ 200、失敗でも 200 にせず `PAYMENT-RESPONSE` を必ず返す。
- **原文非漏洩**：`claim.thesis`・原文とも返さない（構造化フィールドのみ）。
- **author_weight**：`reputation.ts` 準拠（`hit_rate=(hits+0.5*partials)/分母`, `sample_size`, `confidence`）。判定データが無ければ **null**（捏造しない）。`scores-history.jsonl` 未コミットの現状は当面 **全件 null**、`data_note` にその旨を明示。

設定は `.env.example` の `X402_*`（§6実測値を既定）。**`X402_FEE_PAYER`（PayAI）と `X402_FACILITATOR_URL` は安全な既定値が無く、ライブ pay→200 前に投入が必須**（未設定時は素通し200せず verify で失敗）。

## 開発・検証

```bash
npm install
npm run typecheck   # 型チェック
npm test            # オフライン・ネットワーク不要のテスト
# オフライン・ドライラン（fixture 使用）
X_ALPHA_PRICE_SOURCE=fixture X_ALPHA_TODAY=2026-02-01 npm run score
X_ALPHA_OSD_SOURCE=fixture npm run divergence
```

## この環境での検証状況（正直な記載）

このリポジトリを構築した環境のネットワークポリシーは Anthropic / GitHub / パッケージレジストリのみ許可で、**外部連携のライブ実行はできなかった**（proxy が接続拒否）:

- `api.x.com`（list tweets）: 到達不可 → Phase 1/2 のライブ実行は未確認。
- `stooq.com` / 価格ソース: 到達不可 → Phase 3 のライブ価格取得は未確認。
- `osd-coral.vercel.app`: `403 CONNECT`（ポリシー拒否）→ Phase 4 のライブ osd 取得は未確認。
- `ANTHROPIC_API_KEY` 未設定 → Phase 2 の実抽出は未実行。

**ネットワーク不要で実際に走らせて確認できたこと**（`npm test`, 30 tests 全 pass）:

- 取り込み層（fixture のリスト tweets ページ、ネットワーク非依存）: `next_token` ページングが既知 tweet_id で打ち切られること、`author_id`→username 解決、`X_BEARER_TOKEN` 未設定時に明確なエラーで落ちること、tweet_id の BigInt 比較。
- 反証可能性フィルタが scorable / 非scorable を仕様どおり分ける。
- append-only JSONL が重複を排除し、過去行を書き換えない。
- 価格方向・相対の採点、horizon 日付計算、reputation 集計（partial=0.5）。
- **統合テスト**（`test/pipeline.integration.test.ts`, 合成データ）で Phase 3→4 が実行され、価格方向系に hit/miss が付き、`fundamental` タグ付きは `review_pending` に分離され、TSLA で ticker 一致 divergence が抽出され、実現リターンから勝者（osd 側）が判定される。
- CLI 入口が起動し、secret 不足時は「何を入れれば走るか」を出して安全に停止する。

ライブ実行に必要なのは、上記 secret の投入と、CI（GitHub Actions, `.github/workflows/`）からの `api.x.com` / 価格ソース / `osd-coral.vercel.app` への outbound 許可。osd の公開 API の実 JSON 形状は未確認のため、`src/divergence/osdClient.ts` は寛容にパースしている（`holdings`/`positions`/配列等）。実レスポンスで形状を確認後に調整すること。
