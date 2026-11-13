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
