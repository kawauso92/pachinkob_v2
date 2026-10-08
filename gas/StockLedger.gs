// 貯玉台帳。書き込み処理は呼び出し元の AutoHoshu.withLock 内で実行する。
const STOCK_HEADERS = ['ID','登録日時','日付','店','カード','種別','増減玉','金額(円)','関連ID','メモ','状態','取消日時'];

function stockInteger(value, label, allowZero) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) throw new Error(label + 'は整数で入力してください');
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isSafeInteger(number) || (!allowZero && number === 0)) {
    throw new Error(label + 'は整数で入力してください');
  }
  return number;
}

function stockText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(label + 'は1〜' + max + '文字で入力してください');
  }
  return value.trim();
}

// シートの数式解釈を防ぎ、読み出し時には入力どおりの文字列に戻す。
function stockSheetText(value) {
  return /^[=+\-@']/.test(value) ? "'" + value : value;
}

function stockDisplayText(value) {
  const text = String(value || '');
  return /^'[=+\-@']/.test(text) ? text.slice(1) : text;
}

function stockRedemptionBalls(amount, rate) {
  const yen = Number(amount);
  if (!Number.isSafeInteger(yen) || yen <= 0 || yen % 1000 !== 0) throw new Error('換金額は1000円単位で入力してください');
  const kokan = Number(rate);
  if (!Number.isFinite(kokan) || kokan <= 0) throw new Error('店の交換率が不正です');
  const balls = Math.round(yen * kokan / 100);
  if (!Number.isSafeInteger(balls)) throw new Error('換金玉数が大きすぎます。交換率を確認してください');
  return balls;
}

function stockBalancesFromRows(rows) {
  const balances = new Map();
  rows.forEach(row => {
    if (row.status !== '有効') return;
    const key = JSON.stringify([row.shop, row.card]);
    balances.set(key, (balances.get(key) || 0) + Number(row.balls));
  });
  return Array.from(balances, ([key, balance]) => {
    const [shop, card] = JSON.parse(key);
    return {shop, card, balance};
  }).sort((a, b) => a.shop.localeCompare(b.shop) || a.card.localeCompare(b.card));
}

function stockValidateEntry(input, shops) {
  if (!input || typeof input !== 'object') throw new Error('入力が不正です');
  const date = stockText(input.date, '日付', 10);
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('日付が不正です');
  const shop = stockText(input.shop, '店', 80);
  const master = shops.find(item => item.name === shop);
  if (!master) throw new Error('店マスタにない店です');
  const card = stockText(input.card, 'カード', 80);
  if (input.memo !== undefined && input.memo !== null && typeof input.memo !== 'string') throw new Error('メモは文字列で入力してください');
  const memo = input.memo === undefined || input.memo === null ? '' : input.memo.trim();
  if (memo.length > 500) throw new Error('メモは500文字以内にしてください');
  const type = stockText(input.type, '種別', 10);
  if (!['換金','棚卸し','手動'].includes(type) && !(input.allowWork && type === '稼働')) throw new Error('種別が不正です');
  let balls = 0;
  let amount = 0;
  if (type === '換金') {
    amount = stockInteger(input.amount, '換金額', false);
    balls = -stockRedemptionBalls(amount, master.kokan);
  } else if (type === '手動' || type === '稼働') {
    balls = stockInteger(input.balls, '玉数', false);
  } else {
    if (stockInteger(input.actualBalance, '実残高', true) < 0) throw new Error('実残高は0以上にしてください');
  }
  return {date, shop, card, type, balls, amount, memo};
}

function stockSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName('貯玉台帳');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('貯玉台帳');
    sheet.getRange(1, 1, 1, STOCK_HEADERS.length).setValues([STOCK_HEADERS]);
  }
  return sheet;
}

function stockReadRows(sheet) {
  const count = sheet.getLastRow() - 1;
  if (count <= 0) return [];
  return sheet.getRange(2, 1, count, 12).getValues().map((row, index) => ({
    rowNumber:index + 2, id:String(row[0]), registeredAt:stockDateTime(row[1]), date:stockDate(row[2]),
    shop:String(row[3]), card:stockDisplayText(row[4]), type:String(row[5]), balls:Number(row[6]), amount:Number(row[7]) || 0,
    relatedId:String(row[8] || ''), memo:stockDisplayText(row[9]), status:String(row[10]), voidedAt:stockDateTime(row[11])
  })).filter(row => row.id);
}

function stockDate(value) {
  return value instanceof Date ? Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd') : String(value || '').slice(0, 10);
}

function stockDateTime(value) {
  return value instanceof Date ? Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss') : String(value || '');
}

function stockGetLedger() { return {success:true, rows:stockReadRows(stockSheet())}; }
function stockGetBalances() { return {success:true, balances:stockBalancesFromRows(stockReadRows(stockSheet()))}; }

function stockTransferEntries(data, shops) {
  const shop = stockText(data.shop, '店', 80);
  if (!shops.some(item => item.name === shop)) throw new Error('店マスタにない店です');
  const fromCard = stockText(data.fromCard, '移動元カード', 80);
  const toCard = stockText(data.toCard, '移動先カード', 80);
  if (fromCard === toCard) throw new Error('移動元と移動先は別のカードにしてください');
  const balls = stockInteger(data.balls, '玉数', false);
  if (balls < 0) throw new Error('移動玉数は正の整数にしてください');
  const base = {date:data.date, shop, type:'手動', memo:data.memo};
  const debit = stockValidateEntry({...base, card:fromCard, balls:-balls}, shops);
  const credit = stockValidateEntry({...base, card:toCard, balls}, shops);
  return [{...debit, type:'移動'}, {...credit, type:'移動'}];
}

function stockNewEntries(data, shops, rows, allowWork) {
  if (data.type === '移動' || data.action === 'transferStock') return stockTransferEntries(data, shops);
  const entry = stockValidateEntry({...data, allowWork}, shops);
  if (entry.type === '棚卸し') {
    const current = stockBalancesFromRows(rows).find(item => item.shop === entry.shop && item.card === entry.card);
    entry.balls = stockInteger(data.actualBalance, '実残高', true) - (current ? current.balance : 0);
  }
  return [entry];
}

function stockGroup(rows, id) {
  const target = rows.find(row => row.id === id);
  if (!target || target.status !== '有効') throw new Error('有効な台帳行が見つかりません');
  if (!target.relatedId) return [target];
  const group = rows.filter(row => row.relatedId === target.relatedId && row.status === '有効');
  if (group.length !== 2) throw new Error('移動の組が不完全です。台帳を確認してください');
  return group;
}

function stockAppendEntries(sheet, entries) {
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const relatedId = entries.length === 2 ? Utilities.getUuid() : '';
  const ids = entries.map(() => Utilities.getUuid());
  const values = entries.map((item, index) => [ids[index], now, item.date, item.shop, stockSheetText(item.card), item.type,
    item.balls, item.amount, relatedId, stockSheetText(item.memo), '有効', '']);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 12).setValues(values);
  return ids;
}

function stockVoidGroup(sheet, group) {
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const updated = [];
  try {
    group.forEach(row => {
      sheet.getRange(row.rowNumber, 11, 1, 2).setValues([['取消', now]]);
      updated.push(row);
    });
  } catch (error) {
    updated.forEach(row => sheet.getRange(row.rowNumber, 11, 1, 2).setValues([['有効', '']]));
    throw error;
  }
}

function stockHandlePost(data) {
  if (!['addStockEntry','voidStockEntry','editStockEntry','transferStock'].includes(data.action)) throw new Error('不明なアクション');
  const sheet = stockSheet();
  const rows = stockReadRows(sheet);
  if (data.action === 'voidStockEntry') {
    stockVoidGroup(sheet, stockGroup(rows, stockText(data.id, 'ID', 100)));
    return {success:true};
  }
  const shops = getMasters().shops;
  const oldGroup = data.action === 'editStockEntry' ? stockGroup(rows, stockText(data.id, 'ID', 100)) : [];
  const effectiveRows = rows.filter(row => !oldGroup.some(old => old.id === row.id));
  const allowWork = oldGroup.length === 1 && oldGroup[0].type === '稼働';
  const entries = stockNewEntries(data, shops, effectiveRows, allowWork);
  if (oldGroup.length && (oldGroup.length === 2) !== (entries.length === 2)) throw new Error('移動は移動として修正してください');
  if (oldGroup.length) stockVoidGroup(sheet, oldGroup);
  try {
    const ids = stockAppendEntries(sheet, entries);
    return {success:true, ids, entries};
  } catch (error) {
    oldGroup.forEach(row => sheet.getRange(row.rowNumber, 11, 1, 2).setValues([['有効', '']]));
    throw error;
  }
}
