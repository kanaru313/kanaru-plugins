#!/usr/bin/env node
/**
 * benchmark_youtube_cases.js
 *
 * Runs the live test cases specified in the spike across both UA modes
 * (--ua=plugin and --ua=forced) and cache states (cold and warm).
 */

const harness = require('./youtube_harness.js');

async function runBenchmark() {
  const cases = [
    {
      name: '1. Bài nhạc thường (search)',
      script: 'search',
      input: { query: 'Waiting For You MONO' },
    },
    {
      name: '1b. Bài nhạc thường (stream)',
      script: 'stream',
      input: { id: 'CHw1b_1LVBA' },
    },
    {
      name: '2. MV âm nhạc (search)',
      script: 'search',
      input: { query: 'Nấu ăn cho em Đen Vâu' },
    },
    {
      name: '2b. MV âm nhạc (stream)',
      script: 'stream',
      input: { id: 'ukHK1GVyr0I' },
    },
    {
      name: '3. Query tiếng Việt (search)',
      script: 'search',
      input: { query: 'nhạc lofi chill tiếng việt' },
    },
    {
      name: '4. Dán link video (search)',
      script: 'search',
      input: { query: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
    },
    {
      name: '4b. Dán link video (stream)',
      script: 'stream',
      input: { id: 'aqz-KE-bpKQ' },
    },
    {
      name: '5. Dán link playlist (search)',
      script: 'search',
      input: { query: 'https://www.youtube.com/playlist?list=PLOHoVaTp8R7d3L_pjuwIa6nRh4tH5nI4x' },
    },
    {
      name: '6. Trang 2 qua next (search)',
      script: 'search',
      dynamicInput: (prevResults) => {
        const p1 = prevResults['1. Bài nhạc thường (search)'];
        return { next: p1?.response?.data?.next };
      },
    },
    {
      name: '7. Video giới hạn độ tuổi (stream)',
      script: 'stream',
      input: { id: '07FYdnEawAQ' },
    },
    {
      name: '8. Video không khả dụng (stream)',
      script: 'stream',
      input: { id: 'IR0q8wTf118' },
    },
    {
      name: '9. Livestream (stream)',
      script: 'stream',
      input: { id: 'jfKfPfyJRdk' },
    },
  ];

  const results = [];
  const uaModes = ['plugin', 'forced'];

  console.log('Running benchmark across all cases and UA modes...\n');

  for (const uaMode of uaModes) {
    const prevCaseOutputs = {};

    for (const c of cases) {
      let input = c.input;
      if (c.dynamicInput) {
        input = c.dynamicInput(prevCaseOutputs);
        if (!input || !input.next) {
          console.warn(`Skipping ${c.name} in ua=${uaMode}: no next cursor`);
          continue;
        }
      }

      // Cold call
      const cold = harness.runPluginScript(c.script, input, { uaMode });
      prevCaseOutputs[c.name] = cold;

      // Warm call (using cold's storage)
      const warm = harness.runPluginScript(c.script, input, {
        uaMode,
        initialStorage: cold.storage,
      });

      results.push({
        caseName: c.name,
        uaMode,
        cold: {
          status: cold.response?.status || (cold.error ? 'error' : 'null'),
          sends: cold.metrics.sends,
          durationMs: cold.metrics.durationMs,
          bytesReceived: cold.metrics.bytesReceived,
          outputBytes: cold.metrics.outputBytes,
          storageBytes: cold.metrics.storageBytes,
          note: extractNote(cold),
        },
        warm: {
          status: warm.response?.status || (warm.error ? 'error' : 'null'),
          sends: warm.metrics.sends,
          durationMs: warm.metrics.durationMs,
          bytesReceived: warm.metrics.bytesReceived,
          outputBytes: warm.metrics.outputBytes,
          storageBytes: warm.metrics.storageBytes,
          note: extractNote(warm),
        },
      });

      console.log(`[${uaMode.toUpperCase()}] ${c.name}: cold ${cold.metrics.durationMs}ms (${cold.metrics.sends} sends) | warm ${warm.metrics.durationMs}ms (${warm.metrics.sends} sends)`);
    }
  }

  printMarkdownTable(results);
  return results;
}

function extractNote(run) {
  if (run.error) return `Exception: ${run.error.message.slice(0, 40)}`;
  if (run.response?.status === 'scriptError') {
    return `Error: ${run.response.errorMessage.slice(0, 45)}`;
  }
  if (run.response?.status === 'ok') {
    const d = run.response.data;
    if (d.items) return `${d.items.length} items (next: ${!!d.next})`;
    if (d.url) return `Audio: ${d.mimeType?.split(';')[0]} (${Math.round((d.bitrate || 0)/1000)}k)`;
  }
  return 'OK';
}

function printMarkdownTable(results) {
  console.log('\n\n### Bảng đo đạc chi tiết qua harness\n');
  console.log('| Trường hợp | Chế độ UA | Cache | Trạng thái | Số sends | Thời gian (ms) | Byte nhận | Output (B) | Storage (B) | Ghi chú |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');

  for (const r of results) {
    const c = r.cold;
    const w = r.warm;
    console.log(`| ${r.caseName} | \`${r.uaMode}\` | Lạnh | \`${c.status}\` | ${c.sends} | ${c.durationMs} ms | ${c.bytesReceived.toLocaleString()} B | ${c.outputBytes} B | ${c.storageBytes} B | ${c.note} |`);
    console.log(`| ${r.caseName} | \`${r.uaMode}\` | Nóng | \`${w.status}\` | ${w.sends} | ${w.durationMs} ms | ${w.bytesReceived.toLocaleString()} B | ${w.outputBytes} B | ${w.storageBytes} B | ${w.note} |`);
  }
}

if (require.main === module) {
  runBenchmark().catch(console.error);
}
