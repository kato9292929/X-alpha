# X-alpha

X（Twitter）の alpha 投稿を「日付つき・反証可能な主張」として記録し、判定日後に一次データで採点するパイプライン。Claude Portfolio（osd）と同じ型の **逃げない記録（reputation層）** を作り、osd との **食い違い（divergence）** を抽出することが目的。集めることが目的ではない。

取り込みは公式 X API（OAuth2 PKCE, `bookmark.read`）経由のブックマークのみ。**スクレイピングはしない。**

## 大原則（コードでも守っている）

- **原文を再配布しない。** 保存するのは tweet ID・author・投稿日時と、Claude が自分の言葉に要約した構造化主張だけ。生テキストは抽出の入力としてメモリ上に留め、記録ファイル・公開出力に一切残さない（`.gitignore` でダンプ流出も防止）。
- **発信者に中立。** 記録は「日付 D の主張 X → 結果 Y」という事実のみ。評価・断罪の語を入れない。
- **追記のみ（append-only）。** `data/*.jsonl` は追記だけ。過去行を書き換え・削除しない。`tweet_id` で重複取り込みを防ぐ。
- **osd 本体に触らない。** divergence は osd 公開 API を HTTP GET で読むだけ。

## パイプライン

| Phase | 入口 | 役割 | 出力（append-only） |
|---|---|---|---|
| 1 取り込み | `npm run ingest` | bookmarks を取得（ページング対応）、最小の生データを記録 | `data/bookmarks-raw.jsonl` |
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
| `X_CLIENT_ID` (+ `X_CLIENT_SECRET`) | 1 | X アプリ資格情報 |
| `X_USER_ID` | 1 | `GET /2/users/:id/bookmarks` の対象ユーザー |
| `X_REFRESH_TOKEN`（または `X_ACCESS_TOKEN`） | 1 | OAuth2 PKCE ユーザートークン |
| `ANTHROPIC_API_KEY`（+ `X_ALPHA_ANTHROPIC_MODEL`） | 2 | 主張抽出（既定モデル `claude-sonnet-5`） |
| `X_ALPHA_PRICE_SOURCE` | 3 | `stooq`(既定) / `fixture` |
| `OSD_US_PORTFOLIO_URL`, `OSD_JP_PORTFOLIO_URL` | 4 | osd 公開 API（既定値あり） |

### OAuth2 の認可について

ユーザー同意フロー（PKCE authorization-code）は **CI/エージェント環境では完結できない**。ローカルで一度だけ同意を通し、得た refresh token を `X_REFRESH_TOKEN` に入れる。以降は本ツールが access token を自動更新する。

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

- `api.x.com`（bookmarks）: 到達不可 → Phase 1/2 のライブ実行は未確認。
- `stooq.com` / 価格ソース: 到達不可 → Phase 3 のライブ価格取得は未確認。
- `osd-coral.vercel.app`: `403 CONNECT`（ポリシー拒否）→ Phase 4 のライブ osd 取得は未確認。
- `ANTHROPIC_API_KEY` 未設定 → Phase 2 の実抽出は未実行。

**ネットワーク不要で実際に走らせて確認できたこと**（`npm test`, 24 tests 全 pass）:

- 反証可能性フィルタが scorable / 非scorable を仕様どおり分ける。
- append-only JSONL が重複を排除し、過去行を書き換えない。
- 価格方向・相対の採点、horizon 日付計算、reputation 集計（partial=0.5）。
- **統合テスト**（`test/pipeline.integration.test.ts`, 合成データ）で Phase 3→4 が実行され、価格方向系に hit/miss が付き、`fundamental` タグ付きは `review_pending` に分離され、TSLA で ticker 一致 divergence が抽出され、実現リターンから勝者（osd 側）が判定される。
- 4 つの CLI 入口が起動し、secret 不足時は「何を入れれば走るか」を出して安全に停止する。

ライブ実行に必要なのは、上記 secret の投入と、CI（GitHub Actions, `.github/workflows/`）からの `api.x.com` / 価格ソース / `osd-coral.vercel.app` への outbound 許可。osd の公開 API の実 JSON 形状は未確認のため、`src/divergence/osdClient.ts` は寛容にパースしている（`holdings`/`positions`/配列等）。実レスポンスで形状を確認後に調整すること。
