import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const clientRoot = path.join(repoRoot, 'client');

test('client lib loads config with TopN default 200', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'client-config-'));

  try {
    const configPath = path.join(tmpDir, 'config.env');
    await writeFile(
      configPath,
      ['WORKER_BASE_URL=https://example.test', 'ADMIN_TOKEN=admin-token', ''].join('\n'),
      'utf8',
    );

    const { stdout } = await execFile(
      'bash',
      [
        '-lc',
        `source "${path.join(clientRoot, 'lib.sh')}" && client_load_config "${configPath}" && printf '%s\\n%s\\n%s\\n' "$TOP_N" "$CANDIDATE_SOURCE_MODE" "$UPDATE_SOURCE"`,
      ],
      {
        cwd: repoRoot,
      },
    );

    const lines = stdout.trim().split('\n');
    assert.deepEqual(lines, ['200', 'cfst_ipv4_ranges', 'local-cli-optimize']);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('client payload generation keeps default Top200 and local-cli metadata', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'client-payload-'));

  try {
    const configPath = path.join(tmpDir, 'config.env');
    const resultPath = path.join(tmpDir, 'result.csv');
    const preferredPath = path.join(tmpDir, 'preferred.txt');
    const payloadPath = path.join(tmpDir, 'payload.json');

    await writeFile(
      configPath,
      ['WORKER_BASE_URL=https://example.test', 'ADMIN_TOKEN=admin-token', 'TEST_PORT=443', ''].join('\n'),
      'utf8',
    );

    const rows = ['IP 地址,已发送,已接收,丢包率,平均延迟,下载速度(MB/s),地区码'];
    for (let index = 0; index < 205; index += 1) {
      rows.push(`198.51.100.${(index % 250) + 1},4,4,0.00,${20 + index / 10},${30 - index / 20},HKG`);
    }
    await writeFile(resultPath, rows.join('\n'), 'utf8');

    await execFile(
      'bash',
      [
        '-lc',
        `source "${path.join(clientRoot, 'lib.sh')}" && client_load_config "${configPath}" && client_extract_preferred_from_result "${resultPath}" "${preferredPath}" "443" && client_build_update_payload "${preferredPath}" "${payloadPath}" "5955" "205" "local-cli-optimize"`,
      ],
      {
        cwd: repoRoot,
      },
    );

    const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
    assert.equal(payload.preferredIps.length, 200);
    assert.equal(payload.preferredIps[0], '198.51.100.1:443#HKG');
    assert.equal(payload.candidateMode, 'local-cli');
    assert.equal(payload.source, 'local-cli-optimize');
    assert.equal(payload.candidateCount, 5955);
    assert.equal(payload.testedCount, 205);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('client run-update.sh posts Top200 results to Worker update endpoint', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'client-run-'));
  let server;

  try {
    const ipFile = path.join(tmpDir, 'ip.txt');
    const configPath = path.join(tmpDir, 'config.env');
    const resultSourcePath = path.join(tmpDir, 'mock-result.csv');
    const mockCfstPath = path.join(tmpDir, 'mock-cfst.sh');
    const requests = [];

    await writeFile(ipFile, ['104.16.0.0/24', '172.67.0.0/24', ''].join('\n'), 'utf8');

    const rows = ['IP 地址,已发送,已接收,丢包率,平均延迟,下载速度(MB/s),地区码'];
    for (let index = 0; index < 205; index += 1) {
      rows.push(`203.0.113.${(index % 250) + 1},4,4,0.00,${30 + index / 10},${25 - index / 20},LAX`);
    }
    await writeFile(resultSourcePath, rows.join('\n'), 'utf8');

    await writeFile(
      mockCfstPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'outfile=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    -o) outfile="$2"; shift 2 ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        'cp "$MOCK_CFST_RESULT_SOURCE" "$outfile"',
        'echo "mock cfst done"',
        '',
      ].join('\n'),
      'utf8',
    );
    await chmod(mockCfstPath, 0o755);

    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: JSON.parse(body),
        });

        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: true,
            fixedUrls: {
              auto: 'https://example.test/sub/fixed?token=sub-token',
              clash: 'https://example.test/sub/fixed?target=clash&token=sub-token',
              raw: 'https://example.test/sub/fixed?target=raw&token=sub-token',
            },
          }),
        );
      });
    });

    const port = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve(address.port);
      });
    });

    await writeFile(
      configPath,
      [
        `WORKER_BASE_URL=http://127.0.0.1:${port}`,
        'ADMIN_TOKEN=admin-token',
        `CFST_BIN=${mockCfstPath}`,
        `CFST_IP_FILE=${ipFile}`,
        'TOP_N=200',
        'DOWNLOAD_TEST_COUNT=200',
        'OUTPUT_FORMAT=clash',
        `CLIENT_WORKDIR=${tmpDir}`,
        'UPDATE_SOURCE=local-cli-optimize',
        '',
      ].join('\n'),
      'utf8',
    );

    const { stdout } = await execFile('bash', [path.join(clientRoot, 'run-update.sh'), configPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MOCK_CFST_RESULT_SOURCE: resultSourcePath,
      },
    });

    assert.match(stdout, /更新成功/);
    assert.match(stdout, /候选池总数：2/);
    assert.match(stdout, /测速成功数：205/);
    assert.match(stdout, /最终 Top200 数量：200/);
    assert.match(stdout, /自动：http:\/\/127\.0\.0\.1:/);
    assert.match(stdout, /target=raw/);
    assert.match(stdout, /target=clash/);
    assert.match(stdout, /target=surge/);
    assert.match(stdout, /默认推荐订阅地址（Clash）：http:\/\/127\.0\.0\.1:/);
    assert.match(stdout, /鉴权直链 \/ 当前输出格式地址：https:\/\/example\.test\/sub\/fixed\?target=clash&token=sub-token/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/update-preferred');
    assert.equal(requests[0].headers.authorization, 'Bearer admin-token');
    assert.equal(requests[0].body.preferredIps.length, 200);
    assert.equal(requests[0].body.candidateMode, 'local-cli');
    assert.equal(requests[0].body.source, 'local-cli-optimize');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('bootstrap.sh installs global subup wrapper into target directory', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'client-bootstrap-'));

  try {
    const homeDir = path.join(tmpDir, 'home');
    const installDir = path.join(tmpDir, 'bin');
    const configPath = path.join(clientRoot, 'config.env');
    const backupPath = path.join(tmpDir, 'config.backup');

    let hadConfig = false;
    try {
      await readFile(configPath, 'utf8');
      hadConfig = true;
      await writeFile(backupPath, await readFile(configPath, 'utf8'), 'utf8');
    } catch {}

    await writeFile(
      configPath,
      ['WORKER_BASE_URL=https://sub.050721.xyz', 'ADMIN_TOKEN=admin-token', ''].join('\n'),
      'utf8',
    );

    const { stdout } = await execFile('bash', [path.join(clientRoot, 'bootstrap.sh')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: homeDir,
        SUBUP_INSTALL_DIR: installDir,
        SUBUP_SKIP_DEPS: '1',
        SUBUP_SKIP_CFST: '1',
      },
    });

    const subupPath = path.join(installDir, 'subup');
    const wrapper = await readFile(subupPath, 'utf8');
    assert.match(stdout, /全局命令：/);
    assert.match(stdout, /在任意目录执行：subup/);
    assert.match(wrapper, /run-update\.sh/);
    assert.match(wrapper, /config\.env/);
  } finally {
    const configPath = path.join(clientRoot, 'config.env');
    const backupPath = path.join(tmpDir, 'config.backup');
    try {
      const backup = await readFile(backupPath, 'utf8');
      await writeFile(configPath, backup, 'utf8');
    } catch {
      await rm(configPath, { force: true });
    }
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('client run-update.sh fails when CFST produces no usable rows', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'client-error-'));

  try {
    const ipFile = path.join(tmpDir, 'ip.txt');
    const configPath = path.join(tmpDir, 'config.env');
    const resultSourcePath = path.join(tmpDir, 'mock-empty.csv');
    const mockCfstPath = path.join(tmpDir, 'mock-cfst.sh');

    await writeFile(ipFile, ['104.16.0.0/24', ''].join('\n'), 'utf8');
    await writeFile(resultSourcePath, 'IP 地址,已发送,已接收,丢包率,平均延迟,下载速度(MB/s),地区码\n', 'utf8');
    await writeFile(
      mockCfstPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'outfile=""',
        'while [[ $# -gt 0 ]]; do',
        '  case "$1" in',
        '    -o) outfile="$2"; shift 2 ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        'cp "$MOCK_CFST_RESULT_SOURCE" "$outfile"',
        '',
      ].join('\n'),
      'utf8',
    );
    await chmod(mockCfstPath, 0o755);

    await writeFile(
      configPath,
      [
        'WORKER_BASE_URL=https://example.test',
        'ADMIN_TOKEN=admin-token',
        `CFST_BIN=${mockCfstPath}`,
        `CFST_IP_FILE=${ipFile}`,
        `CLIENT_WORKDIR=${tmpDir}`,
        '',
      ].join('\n'),
      'utf8',
    );

    await assert.rejects(
      execFile('bash', [path.join(clientRoot, 'run-update.sh'), configPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          MOCK_CFST_RESULT_SOURCE: resultSourcePath,
        },
      }),
      /CFST 没有输出任何可用结果/,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
