# 自動報酬確定（P列書き込み）実装指示書

**対象**: Codex / 実装担当  
**リポジトリ**: `pachinkob_v2`（AppB = `index.html`）  
**GAS**: `GAS_URL` 定義の Google Apps Script（ソースは別管理）  
**作成**: 2026-09-07  
**ステータス**: 未実装（本ドキュメントが仕様）

---

## 1. 背景と目的

### 列の役割

| スプシ列 | GAS フィールド | 役割 |
|---|---|---|
| **U列** | `kariHoshu` | AppA が台ごとに書く**仮報酬**（台移動時のルール引き継ぎ用） |
| **P列** | `hoshu` | **確定報酬**。AppB の分析・サマリーは **P列のみ**参照 |

### 現状

- AppB「💰 報酬確定」ボタン（`doHoshuConfirm()`）が、指定日の代打記録を**打ち手別に日次集計**し、`calcFinalReward()` で再計算した値を **最後のセッション行の P列** に `writeHoshu` で書き込む。
- U列（`kariHoshu`）は AppB では**一切使わない**（表示・集計なし）。
- 運用上、報酬確定を省略している日が増えており、P列が空のまま分析に報酬が載らない。

### 目的

**日付が過ぎた日**（JST で「今日」より前）について、手動ボタンと**同じロジック**で P列へ自動書き込みする。  
U列の値をコピーするのではなく、既存の `calcFinalReward` 系で**再計算**すること。

---

## 2. スコープ

### やること

- [ ] 未確定の過去日について、日×打ち手ごとに P列を自動書き込み
- [ ] 手動「報酬確定」と**同一の集計・計算**結果になること
- [ ] 二重書き込み・二重カウントを防ぐスキップ条件
- [ ] 手動ボタンは残す（上書き再確定用。挙動は後述）

### やらないこと

- U列 → P列のコピー
- 過去データの一括修復（2026-02 の手入力 P 4件など）— 別タスク
- AppA 側の変更
- 分析画面で `kariHoshu` をフォールバック表示

---

## 3. 推奨アーキテクチャ

**第一推奨: GAS 時間トリガー（サーバー側バッチ）**

AppB を開かなくても動く。日付境界は JST で扱う。

```
毎日 00:30 JST（調整可）
  → GAS: autoConfirmHoshu()
  → 対象: 昨日以前 & 未確定の (date, uchi) グループ
  → 各グループ: calcFinalReward 相当の計算
  → writeHoshu(row=lastRow, hoshu=計算値)
```

**第二推奨（補助）: AppB 起動時**

GAS トリガーのバックアップ。`loadInit()` 成功後に `action=autoConfirmHoshu` を1回呼ぶ（同日中の多重実行は GAS 側で idempotent に）。

**必須: 計算ロジックの共通化**

`index.html` の `doHoshuConfirm()` 内（L2447–2522 付近）の集計ブロックを関数化し、手動・自動の両方から呼ぶ。

```javascript
// 新規抽出（名称は任意）
function buildHoshuConfirmRows(targetDate, records, kishus) {
  // 現 doHoshuConfirm の byUchi 集計 + calcFinalReward まで
  // 戻り値: [{ date, uchi, hoshu, lastRow, sagitamaTotal, ... }, ...]
}
```

GAS 側にも**同等ロジック**を移植する（PHP/Node が無いので GAS 内に複製が現実的）。  
共通化の理想は「計算式を1ファイルに」だが、現構成では **AppB と GAS の二重実装 + テストで一致確認** を許容する。

---

## 4. 確定対象とスキップ条件

### 4.1 対象日

- **JST の「今日」より前**の日付のみ（当日分は確定しない。台移動・追記の余地を残す）
- 例: JST 2026-09-07 実行時 → `date <= 2026-09-06` が対象

### 4.2 対象打ち手

- `uchi !== '自分'` かつ `uchi` が空でない行
- 「自分」は報酬対象外（現行 `doHoshuConfirm` と同じ）

### 4.3 グループキー

`(date, uchi)` — 同一日内の複数台・台移動は**1グループに合算**（現行手動確定と同じ）

### 4.4 スキップ（未確定判定）

**以下のいずれかに該当したら書き込まない（idempotent）:**

1. その `(date, uchi)` グループの **`hoshu` 合計が 0 より大きい**  
   → 既に確定済み（手動・自動・旧手入力いずれも）
2. そのグループの **`lastRow` 行の `hoshu` が既に 0 以外**（合計と二重チェック）

**補足（既知データ）:**

- 2026-02〜03 に P のみ手入力（U=0）が 4件存在。`sum(hoshu) > 0` によりスキップされ、上書きされない想定でよい。
- U>0 かつ P=0 の行は現データ 0件だが、将来 U だけ埋まった状態でも **U は見ず P 合計で判定**する。

### 4.5 報酬 0 円の日

- 計算結果が 0 でも **書き込む**（`writeHoshu(row, 0)`）
- 理由: 「処理済み」とみなし、翌日以降のバッチで毎回再計算しないため
- 代打行が1件も無い `(date, uchi)` はそもそもグループ化されない

---

## 5. 計算仕様（手動確定と完全一致）

以下は `index.html` L2370–2387, L2447–2504 の現行仕様。**変更禁止**（reward curve パッチ済み）。

### 5.1 グループ内集計

| 項目 | 算出 |
|---|---|
| `sagitamaTotal` | グループ内 `sagitama` の合計 |
| `genkinInvestTotal` | グループ内 `genkinInvest` の合計 |
| `avgKitaiJikyu` | `kitaiJikyu × effectiveWeight` の加重平均 |
| `effectiveWeight` | `soKaiten / machineHourlyRate`（`buildMachineHourlyRateMap` + `calcEffectiveKitaiWeight`） |
| `lastRow` | グループ内最大 `row`（最後に入力された行） |

`mochiRatio` の加重平均は手動確定で計算しているが **`calcFinalReward` には渡していない**（現行どおりでよい）。

### 5.2 報酬計算 `calcFinalReward(sagitamaTotal, avgKitaiJikyu, genkinInvestTotal, uchi)`

- `uchi === '自分'` → 0
- 期待時給 ≥ 1800 → スタートライン 5000玉、未満 → 10000玉
- ベース: `floor(sagitama / 2500) * 2500`（スタート未満は 0）
- 控除率: `getKoujoRate(avgKitaiJikyu)`（カーブ式）
- 控除額: `round(genkinInvestTotal * rate)`
- 確定: `max(0, base - koujo)`

### 5.3 書き込み

- **1グループあたり1セル**: `lastRow` の P列のみ
- 既存 `action: 'writeHoshu'` を使用  
  `POST body: { action: 'writeHoshu', row: lastRow, hoshu: 計算値 }`
- グループ内の他行の P列・U列は**触らない**

---

## 6. GAS 側 API 仕様（新規）

### 6.1 `action=autoConfirmHoshu`（POST または GET）

**処理概要:**

1. JST 今日の日付を取得
2. スプシ全行（または直近 N 件）を読み込み
3. `(date, uchi)` グループ化（4.1–4.2 条件）
4. 4.4 スキップ判定
5. 5章どおり計算
6. 未確定グループのみ `writeHoshu` 相当の書き込み
7. 結果 JSON を返す

**レスポンス例:**

```json
{
  "success": true,
  "processed": [
    { "date": "2026-09-01", "uchi": "代1", "row": 351, "hoshu": 0, "skipped": false }
  ],
  "skipped": [
    { "date": "2026-08-27", "uchi": "代1", "reason": "already_confirmed", "sumHoshu": 10000 }
  ],
  "errors": []
}
```

### 6.2 時間トリガー

- 関数名: `runAutoConfirmHoshuDaily`（名称任意）
- スケジュール: **毎日 0:30〜3:00 JST**（負荷・スプシ更新時刻に合わせて調整）
- `autoConfirmHoshu` を内部呼び出し
- 失敗時: `Logger.log` + 任意でメール通知

### 6.3 タイムゾーン

- **必ず `Asia/Tokyo`**  
  `Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd')` 等を使用
- 「日付が過ぎた」の判定はすべて JST

---

## 7. AppB 側変更（`index.html`）

### 7.1 リファクタ

1. `buildHoshuConfirmRows(targetDate, records, kishus)` を抽出
2. `doHoshuConfirm()` は prompt → fetch init → `buildHoshuConfirmRows` → write → UI 更新
3. 手動確定時のスキップは**現状維持**（ユーザーが明示的に再実行・上書き可能）

### 7.2 自動確定の呼び出し（任意・補助）

```javascript
async function maybeAutoConfirmHoshu() {
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'autoConfirmHoshu' }),
    });
    localStorage.removeItem('pachinkob_cache_v1');
  } catch (e) { /* サイレント */ }
}
```

- `loadInit()` で `data.success` 後に1回呼ぶ（オプション）
- UI 通知は不要（ログパネルがあれば debug のみ）

### 7.3 手動ボタン

- ラベル・挙動は維持
- 将来: 「当日は手動のみ / 過去日は自動」などヘルプテキスト追加可（必須ではない）

---

## 8. エッジケース

| ケース | 扱い |
|---|---|
| 同日・同打ち手で複数行 | 合算して lastRow に1値 |
| 差玉合計がスタート未満 | hoshu=0 を書き込み（5.5） |
| 現金控除で 0 円 | 同上 |
| 既に P>0 | スキップ（4.4） |
| 旧データで複数行にバラバラに P | `sum(hoshu)>0` でスキップ。修復は別タスク |
| U列のみ値あり P=0 | 再計算して P に書く（U は参照しない） |
| 試し打ち行 | 打ち手が「自分」でなければ対象。現行と同じ |
| limit=200 で古い日が取れない | GAS バッチは**全件または十分大きい limit**で読む |

---

## 9. テスト計画

### 9.1 単体（計算）

既存 `TEST_RESULTS_reward_curve.txt` / `getKoujoRate` / `calcFinalReward` のケースを流用。

追加: **グループ集計**の fixture

```javascript
// 例: 2026-07-10 代2 — 行276(+6250) + 行275(-4000) → 合計2250 → hoshu=0
```

### 9.2 結合（GAS）

1. テスト行を追加: 昨日・代打・P=0・U任意
2. `autoConfirmHoshu` 実行
3. lastRow の P列 = 期待値、他行不変
4. 再実行 → skipped、P列不変（idempotent）

### 9.3 手動確定との一致

同一 `targetDate` で:

- `buildHoshuConfirmRows` の出力
- 従来 `doHoshuConfirm` の結果  

が一致すること。

### 9.4 回帰

- 分析タブ「報酬合計」= 各レコード `hoshu` 合計（変更なし）
- `kariHoshu` を参照していないこと（grep で確認）

---

## 10. デプロイ手順

1. GAS: `autoConfirmHoshu` 実装 → テストデプロイで POST 確認
2. GAS: 時間トリガー設定（`Asia/Tokyo`）
3. AppB: リファクタ + デプロイ（GitHub Pages 等）
4. 初回: 手動で `autoConfirmHoshu` を1回実行し、直近の P=0 過去日が埋まることをスプシで目視確認
5. 翌朝: トリガーログで前日分が処理されたことを確認

---

## 11. 既知データ上の注意（修復不要・参考）

| 内容 | 件数/金額 | 自動確定への影響 |
|---|---|---|
| P のみ手入力（U=0） | 4件 / ¥40,000 | スキップされる |
| U と P の微小差 | 3日 / 計¥315 | 既確定のためスキップ |
| U>0 P=0 | 0件 | なし |

「単行の差玉だけ見ると報酬ありそう」な日（例: 2026-07-10 代2 の +6250 玉単行）は、**同日合算でスタート未満**のため hoshu=0 が正しい。自動確定でも同結果になる。

---

## 12. 完了条件（Acceptance Criteria）

- [ ] JST で日付が変わった後、代打の未確定日の P列が lastRow に書き込まれる
- [ ] 計算結果は手動「報酬確定」と同一
- [ ] 既に P 合計 > 0 の日×打ち手は上書きしない
- [ ] 同一グループへの二重実行で P列が変わらない
- [ ] U列（`kariHoshu`）は読んでも書き込み根拠にしない
- [ ] AppB 分析・サマリーの `hoshu` 集計が意図どおり動く
- [ ] 時間トリガーが AppB 非起動でも動作する

---

## 13. 参照コード位置（AppB）

| 内容 | ファイル | 行目（目安） |
|---|---|---|
| GAS URL | `index.html` | L581 |
| 報酬計算 | `index.html` | L2355–2387 |
| 手動確定 | `index.html` | L2404–2552 |
| P列書込 POST | `index.html` | L2528–2531 |
| 分析の hoshu 合計 | `index.html` | L1246, L1342, L1752 等 |

GAS の `writeHoshu` / 列マッピング（P=`hoshu`, U=`kariHoshu`）は GAS プロジェクト側ソースを参照すること。
