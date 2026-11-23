// Kategorisasi dengan Claude API, hanya dipakai untuk item yang tidak dikenali kata kunci.
// SDK dimuat saat dibutuhkan saja, sehingga aplikasi tetap jalan offline tanpa AI.

const SDK_URL = '../vendor/anthropic-sdk.mjs'; // @anthropic-ai/sdk 1.2.0, dibundel untuk browser
const MODEL = 'claude-opus-5-5';

let clientPromise = null;
let clientKey = null;

async function getClient(apiKey) {
  if (!clientPromise || clientKey !== apiKey) {
    clientKey = apiKey;
    clientPromise = import(SDK_URL).then((mod) => {
      const Anthropic = mod.default || mod.Anthropic;
      // Kunci API disimpan di perangkat pengguna sendiri; tidak ada server perantara.
      return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    });
  }
  return clientPromise;
}

/**
 * @param {Array<{desc:string, amount:number}>} entries
 * @param {Array} categories
 * @param {string} apiKey
 * @returns {Promise<Array<{index:number, catId:string, itemId:string}>>}
 */
export async function categorizeWithAI(entries, categories, apiKey) {
  if (!apiKey) throw new Error('Isi API key Claude dulu di menu Pengaturan.');
  const client = await getClient(apiKey);

  const catalog = categories.map((c) => ({
    category_id: c.id,
    category: c.name,
    items: c.items.map((i) => ({ item_id: i.id, name: i.name })),
  }));
  const list = entries.map((e, index) => ({ index, text: e.desc, amount: e.amount }));

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  category_id: { type: 'string' },
                  item_id: { type: 'string' },
                },
                required: ['index', 'category_id', 'item_id'],
                additionalProperties: false,
              },
            },
          },
          required: ['results'],
          additionalProperties: false,
        },
      },
    },
    system:
      'You sort household expense notes from an Indonesian family budget into a fixed set of categories. ' +
      'Notes are short and informal, in Indonesian or English, often with brand names, places or slang. ' +
      'For each note pick exactly one category_id and one item_id that belongs to that category, using only ids from the catalog. ' +
      'If nothing fits well, use the item named "Lainnya" in the closest category, or category "others".',
    messages: [
      {
        role: 'user',
        content:
          `Catalog:\n${JSON.stringify(catalog)}\n\nNotes to categorize:\n${JSON.stringify(list)}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('AI menolak memproses permintaan ini. Pilih kategori secara manual.');
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Jawaban AI tidak bisa dibaca. Coba lagi.');
  }
  return (parsed.results || [])
    .map((r) => ({ index: r.index, catId: r.category_id, itemId: r.item_id }))
    .filter((r) => {
      const c = categories.find((x) => x.id === r.catId);
      return c && c.items.some((i) => i.id === r.itemId);
    });
}

/**
 * Baca foto struk dengan Claude: nama toko, tanggal, total bayar, dan kategori yang paling cocok.
 * @param {string} base64 gambar JPEG (tanpa awalan data:)
 * @returns {Promise<{isReceipt:boolean, merchant:string, date:string, total:number, itemCount:number, catId:string|null, itemId:string|null}>}
 */
export async function readReceiptWithAI(base64, categories, apiKey) {
  if (!apiKey) throw new Error('Isi API key Claude dulu di menu Pengaturan.');
  const client = await getClient(apiKey);
  const catalog = categories.map((c) => ({
    category_id: c.id,
    category: c.name,
    items: c.items.map((i) => ({ item_id: i.id, name: i.name })),
  }));

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            is_receipt: { type: 'boolean' },
            merchant: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD, or empty if not printed' },
            total: { type: 'integer', description: 'Final amount paid in rupiah' },
            item_count: { type: 'integer' },
            category_id: { type: 'string' },
            item_id: { type: 'string' },
          },
          required: ['is_receipt', 'merchant', 'date', 'total', 'item_count', 'category_id', 'item_id'],
          additionalProperties: false,
        },
      },
    },
    system:
      'You read photos of shopping receipts from Indonesia for a household budget app. ' +
      'Return the store name (short, as printed, e.g. "Indomaret Cibubur"), the transaction date as YYYY-MM-DD, ' +
      'and the final amount the customer paid in rupiah as an integer: use the TOTAL / GRAND TOTAL / TOTAL BAYAR line ' +
      'after discounts and including tax, not the cash tendered and not the change (KEMBALI). ' +
      'In Indonesian receipts a dot or comma between groups of three digits is a thousands separator. ' +
      'Also pick the single best category_id and item_id for the whole purchase from the catalog. ' +
      'If the image is not a receipt or the total is unreadable, set is_receipt to false and total to 0.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: `Catalog:\n${JSON.stringify(catalog)}` },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('AI menolak memproses foto ini. Masukkan secara manual.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let r;
  try { r = JSON.parse(text); } catch { throw new Error('Jawaban AI tidak bisa dibaca. Coba lagi.'); }
  const cat = categories.find((c) => c.id === r.category_id);
  const valid = cat && cat.items.some((i) => i.id === r.item_id);
  return {
    isReceipt: !!r.is_receipt && r.total > 0,
    merchant: String(r.merchant || '').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '',
    total: Math.round(Number(r.total) || 0),
    itemCount: Number(r.item_count) || 0,
    catId: valid ? r.category_id : null,
    itemId: valid ? r.item_id : null,
  };
}
