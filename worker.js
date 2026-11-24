require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealth);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Normalisasi format JSON dari ekstensi Cookie-Editor agar diterima Playwright
function formatCookiesForPlaywright(rawJson) {
  const parsed = JSON.parse(rawJson);
  return parsed.map((c) => {
    let sameSite = 'Lax';
    if (c.sameSite === 'no_restriction' || c.sameSite === 'None') sameSite = 'None';
    if (c.sameSite === 'strict' || c.sameSite === 'Strict') sameSite = 'Strict';

    return {
      name: c.name,
      value: c.value,
      domain: c.domain || '.facebook.com',
      path: c.path || '/',
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
      sameSite,
    };
  });
}

// Parse format proxy http://user:pass@host:port
function parseProxy(proxyStr) {
  if (!proxyStr) return undefined;
  const url = new URL(proxyStr);
  return {
    server: `${url.protocol}//${url.hostname}:${url.port}`,
    username: url.username || undefined,
    password: url.password || undefined,
  };
}

async function executeTask(task) {
  console.log(`[MULAI] Task ${task.id} untuk akun: ${task.accounts.name}`);
  await supabase.from('tasks').update({ status: 'processing' }).eq('id', task.id);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: parseProxy(task.accounts.proxy),
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'id-ID',
    });

    const cookies = formatCookiesForPlaywright(task.accounts.cookies);
    await context.addCookies(cookies);

    const page = await context.newPage();
    await page.goto(task.campaigns.target_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(randomBetween(4000, 7000));

    // Cek apakah sesi cookie mati / kena checkpoint
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
      await supabase.from('accounts').update({ status: 'expired' }).eq('id', task.account_id);
      throw new Error('Sesi cookie expired atau akun terkena checkpoint.');
    }

    const action = task.campaigns.action_type;

    // 1. Proses Like
    if (action === 'like' || action === 'both') {
      const likeBtn = page.locator('[aria-label="Suka"], [aria-label="Like"]').first();
      if (await likeBtn.isVisible({ timeout: 8000 })) {
        await likeBtn.click();
        console.log(`  -> Berhasil klik Like`);
        await sleep(randomBetween(3000, 6000));
      } else {
        console.log(`  -> Tombol Like tidak ditemukan / sudah di-like`);
      }
    }

    // 2. Proses Komentar
    if ((action === 'comment' || action === 'both') && task.comment_text) {
      const commentBox = page
        .locator('[aria-label="Tulis komentar"], [aria-label="Write a comment"], [role="textbox"]')
        .first();

      if (await commentBox.isVisible({ timeout: 8000 })) {
        await commentBox.click();
        await sleep(randomBetween(1000, 2500));
        await page.keyboard.type(task.comment_text, { delay: randomBetween(60, 130) });
        await sleep(randomBetween(1500, 3000));
        await page.keyboard.press('Enter');
        console.log(`  -> Komentar terkirim: "${task.comment_text}"`);
        await sleep(randomBetween(4000, 6000));
      } else {
        throw new Error('Kolom komentar tidak ditemukan atau komentar dikunci.');
      }
    }

    await supabase
      .from('tasks')
      .update({ status: 'success', log_message: 'Selesai dieksekusi' })
      .eq('id', task.id);
    console.log(`[SELESAI] Task ${task.id} sukses.`);
  } catch (err) {
    console.error(`[GAGAL] Task ${task.id}:`, err.message);
    await supabase
      .from('tasks')
      .update({ status: 'failed', log_message: err.message })
      .eq('id', task.id);
  } finally {
    if (browser) await browser.close();
  }
}

async function startWorker() {
  console.log('Worker aktif. Menunggu jadwal antrean dari Supabase...');
  while (true) {
    const now = new Date().toISOString();
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*, accounts(*), campaigns(*)')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('Error polling Supabase:', error.message);
    } else if (tasks && tasks.length > 0) {
      await executeTask(tasks[0]);
    }

    await sleep(10000); // Cek database setiap 10 detik
  }
}

async function runDueTasksOnce() {
  const now = new Date().toISOString();
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*, accounts(*), campaigns(*)')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true });

  if (error) {
    throw new Error(`Error polling Supabase: ${error.message}`);
  }

  if (!tasks || tasks.length === 0) {
    console.log('Tidak ada tugas yang sudah jatuh tempo.');
    return;
  }

  console.log(`Menjalankan ${tasks.length} tugas yang sudah jatuh tempo...`);
  for (const task of tasks) {
    await executeTask(task);
  }
}

if (process.argv.includes('--once')) {
  runDueTasksOnce()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
} else {
  startWorker();
}