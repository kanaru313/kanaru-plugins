// Smoke test of Color Coded Lyrics plugin: `node tools/check_colorcodedlyrics_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const pluginDir = path.join(__dirname, '..', 'src', 'colorcodedlyrics');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
const commonCode = fs.readFileSync(path.join(pluginDir, 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(pluginDir, 'src', 'search.js'), 'utf8');
const lyricsCode = fs.readFileSync(path.join(pluginDir, 'src', 'lyrics.js'), 'utf8');

function assertJsonEqual(actual, expected) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
}

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log(`✓ ${name}`);
}

async function testAsync(name, fn) {
  await fn();
  n++;
  console.log(`✓ ${name}`);
}

(async () => {
  // 1. Manifest structure check
  test('plugin.json structure and config schema', () => {
    assert.strictEqual(manifest.metadata.apiVersion, 1);
    assert.strictEqual(manifest.metadata.type, 'lyrics');
    assert.strictEqual(manifest.metadata.name, 'Color Coded Lyrics');
    assert.strictEqual(typeof manifest.metadata.version, 'number');
    assert.ok(Array.isArray(manifest.metadata.hosts));
    assert.ok(manifest.metadata.hosts.includes('colorcodedlyrics.com'));
    assert.strictEqual(manifest.script.search, 'search.js');
    assert.strictEqual(manifest.script.lyrics, 'lyrics.js');

    // Config schema check
    assert.ok(manifest.config);
    assert.ok(manifest.config.preferredSection);
    assert.strictEqual(manifest.config.preferredSection.mode, 'select');
    assert.strictEqual(manifest.config.preferredSection.default, 'all');
    assert.ok(Array.isArray(manifest.config.preferredSection.options));
    assert.ok(manifest.config.preferredSection.options.some(o => o.value === 'all'));
    assert.ok(manifest.config.preferredSection.options.some(o => o.value === 'rom'));
    assert.ok(manifest.config.preferredSection.options.some(o => o.value === 'original'));
    assert.ok(manifest.config.preferredSection.options.some(o => o.value === 'trans'));
  });

  // 2. Unit tests for helpers: htmlDecode, parsePostTitle, cleanHtmlSection
  test('common.js helpers parse titles, decode entities, and clean HTML', () => {
    const g = {};
    const env = new Function(...Object.keys(g), commonCode + '\nreturn { htmlDecode, parsePostTitle, cleanHtmlSection, extractSections, formatSections };')(...Object.values(g));

    // htmlDecode
    assert.strictEqual(env.htmlDecode('&amp; &#8211; &#8217; &quot; &nbsp; &#65;'), "& – ' \"   A");

    // parsePostTitle
    assertJsonEqual(env.parsePostTitle('BTS (방탄소년단) &#8211; Life Goes On'), {
      artist: 'BTS (방탄소년단)',
      title: 'Life Goes On'
    });
    assertJsonEqual(env.parsePostTitle('TWICE &#8211; TT'), {
      artist: 'TWICE',
      title: 'TT'
    });
    assertJsonEqual(env.parsePostTitle('NewJeans (뉴진스) – Super Shy'), {
      artist: 'NewJeans (뉴진스)',
      title: 'Super Shy'
    });
    assertJsonEqual(env.parsePostTitle('SingleTitleWithoutDash'), {
      artist: 'Unknown',
      title: 'SingleTitleWithoutDash'
    });

    // cleanHtmlSection
    const rawHtml = `<span style="color: #c03f44">Smooth like butter</span><br />\n<span style="color: #c03f44">Like a criminal undercover</span></p>\n<p><span style="color: #b7c185">Cool shade stunner</span>`;
    const cleaned = env.cleanHtmlSection(rawHtml);
    assert.strictEqual(cleaned, 'Smooth like butter\nLike a criminal undercover\n\nCool shade stunner');
  });

  // 3. Section extraction and formatting across formats
  test('extractSections and formatSections handle Gutenberg columns and tables', () => {
    const g = {};
    const env = new Function(...Object.keys(g), commonCode + '\nreturn { extractSections, formatSections };')(...Object.values(g));

    // Gutenberg multi-column
    const gutenbergHtml = `
      <div class="wp-block-columns">
        <div class="wp-block-column">
          <p><strong><span class="has-inline-color">Romanization</span></strong></p>
          <p>eoneu nal sesangi meomchweosseo<br />amureon yegodo hana eopshi</p>
        </div>
        <div class="wp-block-column">
          <p><strong><span class="has-inline-color">Hangul</span></strong></p>
          <p>어느 날 세상이 멈췄어<br />아무런 예고도 하나 없이</p>
        </div>
        <div class="wp-block-column">
          <p><strong><span class="has-inline-color">Translation</span></strong></p>
          <p>One day the world stopped<br />Without any warning</p>
        </div>
      </div>
      <div class="sharedaddy">Share this</div>
    `;

    const sections = env.extractSections(gutenbergHtml);
    assert.strictEqual(sections.length, 3);
    assert.strictEqual(sections[0].name, 'Romanization');
    assert.strictEqual(sections[1].name, 'Hangul');
    assert.strictEqual(sections[2].name, 'Translation');

    // format 'all'
    const formattedAll = env.formatSections(sections, 'all');
    assert.ok(formattedAll.includes('[Romanization]\neoneu nal sesangi meomchweosseo'));
    assert.ok(formattedAll.includes('[Hangul]\n어느 날 세상이 멈췄어'));
    assert.ok(formattedAll.includes('[Translation]\nOne day the world stopped'));

    // format 'rom'
    const formattedRom = env.formatSections(sections, 'rom');
    assert.strictEqual(formattedRom, 'eoneu nal sesangi meomchweosseo\namureon yegodo hana eopshi');

    // format 'original'
    const formattedOrig = env.formatSections(sections, 'original');
    assert.strictEqual(formattedOrig, '어느 날 세상이 멈췄어\n아무런 예고도 하나 없이');

    // format 'trans'
    const formattedTrans = env.formatSections(sections, 'trans');
    assert.strictEqual(formattedTrans, 'One day the world stopped\nWithout any warning');

    // Table multi-column
    const tableHtml = `
      <table>
        <tr>
          <th>Romanization</th>
          <th>Chinese</th>
          <th>Translation</th>
        </tr>
        <tr>
          <td>bu yao zai kao lu<br />jiu he wo yi qi</td>
          <td>不要再考虑<br />就和我一起</td>
          <td>Stop considering<br />Just be with me</td>
        </tr>
      </table>
    `;
    const tableSections = env.extractSections(tableHtml);
    assert.strictEqual(tableSections.length, 3);
    assert.strictEqual(tableSections[0].name, 'Romanization');
    assert.strictEqual(tableSections[1].name, 'Chinese');
    assert.strictEqual(tableSections[2].name, 'Translation');
  });

  // 4. search.js mapping and filtering
  test('search.js maps candidates and filters index/discography posts', () => {
    const mockPosts = [
      { id: 181473, title: { rendered: 'NewJeans (뉴진스) Profile &amp; Lyrics Index' } },
      { id: 190952, title: { rendered: 'NewJeans (뉴진스) – Super Shy' } },
      { id: 177745, title: { rendered: 'NewJeans (뉴진스) &#8211; Hype Boy' } }
    ];

    const Response = {
      success: (v) => ({ ok: true, data: v }),
      error: (m, o) => ({ ok: false, message: m, ...(o || {}) })
    };

    const g = {
      load: () => {},
      Response,
      fetch: () => ({
        status: 200,
        text: () => JSON.stringify(mockPosts),
        header: () => null
      })
    };

    const fullSearch = commonCode + '\n' + searchCode;
    const fn = new Function(...Object.keys(g), fullSearch + '\nreturn execute;')(...Object.values(g));

    const res = fn({ title: 'Super Shy', artist: 'NewJeans' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data.length, 2); // 181473 filtered out
    assertJsonEqual(res.data[0], {
      id: '190952',
      title: 'Super Shy',
      artist: 'NewJeans (뉴진스)'
    });
    assertJsonEqual(res.data[1], {
      id: '177745',
      title: 'Hype Boy',
      artist: 'NewJeans (뉴진스)'
    });
  });

  // 5. lyrics.js execution with localConfig
  test('lyrics.js fetches post and formats according to preferredSection config', () => {
    const mockPost = {
      id: 190952,
      content: {
        rendered: `
          <div class="wp-block-columns">
            <div class="wp-block-column">
              <p><strong><span class="has-inline-color">Romanization</span></strong></p>
              <p>I'm super shy, super shy<br />But wait a minute while I make you mine</p>
            </div>
            <div class="wp-block-column">
              <p><strong><span class="has-inline-color">Hangul</span></strong></p>
              <p>I'm super shy, super shy<br />떨리는 지금도 you're on my mind</p>
            </div>
          </div>
        `
      }
    };

    const Response = {
      success: (v) => ({ ok: true, data: v }),
      error: (m, o) => ({ ok: false, message: m, ...(o || {}) })
    };

    let mockConfig = 'all';
    const localConfig = {
      getItem: (key) => key === 'preferredSection' ? mockConfig : null
    };

    const g = {
      load: () => {},
      Response,
      localConfig,
      fetch: (url) => {
        if (url.includes('190952')) {
          return { status: 200, text: () => JSON.stringify(mockPost), header: () => null };
        }
        return { status: 404, text: () => '{}', header: () => null };
      }
    };

    const fullLyrics = commonCode + '\n' + lyricsCode;
    const fn = new Function(...Object.keys(g), fullLyrics + '\nreturn execute;')(...Object.values(g));

    // Test 'all'
    mockConfig = 'all';
    const resAll = fn('190952');
    assert.strictEqual(resAll.ok, true);
    assert.strictEqual(resAll.data.type, 'txt');
    assert.ok(resAll.data.data.includes('[Romanization]'));
    assert.ok(resAll.data.data.includes('[Hangul]'));

    // Test 'rom'
    mockConfig = 'rom';
    const resRom = fn('190952');
    assert.strictEqual(resRom.ok, true);
    assert.strictEqual(resRom.data.data, "I'm super shy, super shy\nBut wait a minute while I make you mine");

    // Test 'original'
    mockConfig = 'original';
    const resOrig = fn('190952');
    assert.strictEqual(resOrig.ok, true);
    assert.strictEqual(resOrig.data.data, "I'm super shy, super shy\n떨리는 지금도 you're on my mind");

    // Test 404
    const res404 = fn('999999');
    assert.strictEqual(res404.ok, true);
    assert.strictEqual(res404.data, null);
  });

const cp = require('child_process');

function syncLiveFetch(url) {
  const args = ['-s', '-i', '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', '-H', 'Accept: application/json', url];
  const raw = cp.execFileSync('curl', args, { encoding: 'utf8' });
  const parts = raw.split(/\r?\n\r?\n/);
  const headerLines = parts[0].split(/\r?\n/);
  const statusLine = headerLines[0] || '';
  const statusMatch = statusLine.match(/HTTP\/\S+\s+(\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const body = parts.slice(1).join('\n\n');
  return {
    status,
    text: () => body,
    header: (name) => {
      const re = new RegExp('^' + name + ':\\s*(.+)$', 'im');
      const m = parts[0].match(re);
      return m ? m[1].trim() : null;
    }
  };
}

// 6. Live end-to-end smoke test
test('Live smoke test against colorcodedlyrics.com for TWICE - TT', () => {
  const Response = {
    success: (v) => ({ ok: true, data: v }),
    error: (m, o) => ({ ok: false, message: m, ...(o || {}) })
  };

  const g = {
    load: () => {},
    Response,
    localConfig: { getItem: () => 'all' },
    fetch: syncLiveFetch
  };

  const searchFn = new Function(...Object.keys(g), commonCode + '\n' + searchCode + '\nreturn execute;')(...Object.values(g));
  const lyricsFn = new Function(...Object.keys(g), commonCode + '\n' + lyricsCode + '\nreturn execute;')(...Object.values(g));

  const sRes = searchFn({ title: 'TT', artist: 'TWICE' });
  assert.strictEqual(sRes.ok, true, 'Search returned ok');
  assert.ok(Array.isArray(sRes.data));
  assert.ok(sRes.data.length > 0, 'Found results for TT');

  const ttItem = sRes.data.find(item => item.title.toUpperCase().includes('TT'));
  assert.ok(ttItem, 'Found TT item in search results');
  console.log(`   Found live search item: ID ${ttItem.id} | ${ttItem.artist} - ${ttItem.title}`);

  // Test another song: NewJeans - Super Shy
  const sRes2 = searchFn({ title: 'Super Shy', artist: 'NewJeans' });
  assert.strictEqual(sRes2.ok, true, 'Search returned ok for Super Shy');
  assert.ok(sRes2.data.length > 0, 'Found results for Super Shy');
  const superShyItem = sRes2.data.find(item => item.title.toLowerCase().includes('super shy'));
  assert.ok(superShyItem, 'Found Super Shy item');
  console.log(`   Found live search item: ID ${superShyItem.id} | ${superShyItem.artist} - ${superShyItem.title}`);

  const lRes2 = lyricsFn(superShyItem.id);
  assert.strictEqual(lRes2.ok, true);
  assert.ok(lRes2.data.data.includes('super shy') || lRes2.data.data.includes('Super Shy'));
  console.log(`   Super Shy lyrics fetched successfully (${lRes2.data.data.length} chars)`);
});

  console.log(`\nAll ${n} tests passed successfully!`);
})();
