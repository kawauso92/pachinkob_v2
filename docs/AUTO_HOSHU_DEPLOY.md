# 自動報酬確定の反映手順

ローカル作成済み。本番GAS・トリガーは未変更。GitHubへのpushだけではGASは更新されません。

## 対象

Apps Script: https://script.google.com/home/projects/1q3WGeF97a4XSVZdJL-H2AXmHEdP3zlYz6XFjGP8trB-p7ZMRjxPoiQ6Q/edit

開始日は導入作業翌日以降。開始日前の記録は既存処理を維持し、自動・再確定では変更しません。
既存の docs/AUTO_HOSHU_CONFIRM.md より本書と今回のユーザー合意を優先します。

## GASの変更

1. 現在のコードとデプロイバージョン23をバックアップ。
2. 既存 `function doPost(e)` を `function doPostLegacy(e)` に変更。
3. 既存 `function doGet(e)` を `function doGetLegacy(e)` に変更。
4. `submitRecord` の `const hoshu = hoshuDetail.final;` を次に変更。

```js
const hoshu = AutoHoshu.isManaged(data.date) ? 0 : hoshuDetail.final;
```

5. `gas/AutoHoshu.gs` を同名の新しいスクリプトファイルとして追加。
6. `setupAutoHoshu` の `YYYY-MM-DD` を実際の導入翌日以降の日付に変更し、一度実行する。
   同じ開始日で再実行してもトリガーは重複作成しない。既存warmupはそのまま。
7. 既存のウェブアプリデプロイを新バージョンへ更新。URLは変更しない。
8. AppA・AppBをそれぞれpushし、Pages反映を確認。開始日までに両アプリを更新する。

トリガーはJST 0:30頃。時刻には幅があります。稼働開始日当日の記録は翌日初めて確定します。
トリガー失敗はApps Script実行ログと標準の失敗通知で確認します。

## 動作

- AppA: 仮報酬と送信確認を実効時間で加重。入力中の値は変更しない。
- 旧方式の端末累計は一度GASの同日同打ち手記録から重みを移行する。
- 新規記録のP列は0。日次確定で対象グループの最終行だけに報酬を書く。
- 確定済み状態・計算対象の指紋はScript Propertiesに保存。0円も処理済み。
- 記録の追記・削除・報酬関連の修正・機種回転数変更は指紋の違いで再確定必要と表示。
- 自動では確定済みを上書きしない。設定の再確定は開始日以降かつ過去日のみ。
- 手動再確定はその日の全打ち手を再集計。グループ途中のP列を0にし、最終行に1件だけ記録。
- レコード取得は現行GASと同じ全件。U列コピーは行わない。
- 読み書きは同じScriptLockで保護。シートを人が直接編集する操作まではロックできない。
- 通信応答が確認できない場合、AppBは成功扱いにせず再確認を促す。

## 本番確認（まだ未実施）

開始日以降のテスト用シートで、1台・複数台・0円・再実行・追記後の再確定を確認する。
本番の過去記録をテスト用に書き換えない。
旧方式から新方式への端末累計移行は、一度オンラインでAppAを開いて完了させる。

## ローカル検証

`node tests/auto_hoshu.test.cjs` をAppBフォルダで実行。

## 反映用コードの自動生成（任意）

既存コードをローカルの `Code.gs` として保存した場合、次のコマンドで上記2〜5の変更をまとめたファイルを生成できます。

```sh
node gas/prepare-gas.cjs Code.gs Code.auto-hoshu.gs
```

生成したファイル全体を既存コードと置き換える場合、AutoHoshu.gsを別途追加しないでください（二重定義を防止）。
開始日の指定・setupAutoHoshuの実行・既存デプロイ更新は必要です。

AppAはGASへ送る期待時給の整数丸めに合わせて仮報酬を計算し、1,800円境界で画面と確定がずれないようにしています。
