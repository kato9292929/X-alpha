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
| `X_REFRESH_TOKEN`（または `X_ACCESS_TOKEN`） | 1 | OAuth2 PKCE ユーザートークン（ローテートする→自動書き戻し） |
| `GH_PAT_FOR_SECRET` | 1 | ローテートした `X_REFRESH_TOKEN` を secret へ書き戻す PAT（Actions secrets: write） |
| `ANTHROPIC_API_KEY`（+ `X_ALPHA_ANTHROPIC_MODEL`） | 2 | 主張抽出（既定モデル `claude-sonnet-5`） |
| `X_ALPHA_PRICE_SOURCE` | 3 | `stooq`(既定) / `fixture` |
| `OSD_US_PORTFOLIO_URL`, `OSD_JP_PORTFOLIO_URL` | 4 | osd 公開 API（既定値あり） |

### OAuth2 の認可（X_REFRESH_TOKEN の取得）

ユーザー同意フロー（PKCE authorization-code）は **CI/エージェント環境では完結できない**。付属スクリプト `npm run auth`（`scripts/getRefreshToken.ts`）を **自分のローカル PC で一度だけ** 実行し、得た refresh token を secret に入れる。以降は本ツールが access token を自動更新する。

スコープは `bookmark.read tweet.read users.read offline.access`（`offline.access` があることで X が refresh token を返す）。

**手順:**

1. **X 開発者ポータルでアプリを用意**
   - User authentication settings を有効化し、**Type of App = Native App（public client）** または Web App（confidential client）を選ぶ。
   - **App permissions = Read**。
   - **Callback URI / Redirect URL** に `http://127.0.0.1:8723/callback` を**そのまま**登録する（`X_REDIRECT_URI` を変える場合は同じ値を登録）。
   - Client ID（confidential なら Client Secret も）を控える。

2. **ローカルで環境変数を設定して実行**（この環境ではなく手元の PC で）
   ```bash
   npm install
   export X_CLIENT_ID=あなたのClientID
   # confidential app の場合のみ:
   # export X_CLIENT_SECRET=あなたのClientSecret
   npm run auth
   ```

3. **ブラウザで認可**
   - ターミナルに表示された URL を開き、アプリを承認する。
   - スクリプトが `http://127.0.0.1:8723/callback` で認可コードを受け取り、自動でトークン交換する。

4. **出力をコピー**
   - `X_REFRESH_TOKEN=...` と `X_USER_ID=...`（`users.read` により自動解決）が表示される。
   - これらを GitHub Actions の secret（`X_REFRESH_TOKEN`, `X_USER_ID`。confidential なら `X_CLIENT_SECRET` も）と、`X_CLIENT_ID` に設定する。
   - access token は自動更新されるため保存不要。

> 注意: リダイレクト URI はポータル登録値と `X_REDIRECT_URI` が**完全一致**している必要がある。ポート 8723 が使えない場合は `X_REDIRECT_URI` を変更し、同じ値をポータルにも登録すること。この環境（クラウド側）は `api.x.com` へ到達できないため、`npm run auth` は必ず手元の PC で実行する。

### refresh token のローテーション（重要）

X の OAuth2 refresh token は**ローテートする**。1 回 refresh すると新しい refresh token が発行され、**古い値は即座に無効化**される。そのため、実行のたびに新しい値を GitHub Actions の secret `X_REFRESH_TOKEN` に**書き戻さないと**、次回以降は `token refresh failed 400: invalid_request / "Value passed for the token was invalid."` で失敗し続ける。

本リポジトリの対応:

- トークン更新は `src/ingest/xClient.ts` の `XTokenManager` に集約。refresh のたびにレスポンスの `refresh_token` を現在値と比較し、**値が変わったときだけ**最新値をローカルファイル `.rotated-refresh-token`（gitignore 済み）に書き出す（`src/lib/tokenStore.ts`）。ミッドラン 401 での再 refresh も**常に最新の refresh token**を使う。
- `.github/workflows/pipeline.yml` の最終ステップ（`if: always()`）が、そのファイルがあれば `gh secret set X_REFRESH_TOKEN`（値は標準入力経由、ログ非表示）で secret を更新する。データ処理が途中で失敗しても、既に発生したローテーションは書き戻される。
- **PAT が未設定でローテーションが起きた場合は、ジョブを明示的に失敗させる**（`::error::` ＋ exit 1）。黙って古い値のまま次回失効するのを防ぐ。

#### Katomasa 側で必要な作業

1. **secret 書き込み権限を持つ PAT を用意し、secret 名 `GH_PAT_FOR_SECRET` で登録**する。
   - 推奨: **fine-grained PAT** / Repository access = `kato9292929/X-alpha` のみ / Repository permissions → **Secrets: Read and write**（＝ Actions secrets の書き込み最小権限）。
   - 代替: classic PAT なら `repo` スコープ。
2. **有効な refresh token を入れ直す（初期化）**。現在の `X_REFRESH_TOKEN` は既に失効している見込みのため、手元 PC で `npm run auth` を再実行し、出力された `X_REFRESH_TOKEN` を secret に上書き設定する。以降はローテーションが自動で書き戻される。

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
