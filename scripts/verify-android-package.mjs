import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const expectedPackageName = 'com.jeck5001.jiapai';
const apkPath = process.argv[2] ?? 'android/app/build/outputs/apk/debug/app-debug.apk';

async function findAapt() {
  const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) throw new Error('ANDROID_HOME 或 ANDROID_SDK_ROOT 未设置');
  const buildToolsRoot = join(sdkRoot, 'build-tools');
  const versions = await readdir(buildToolsRoot, { withFileTypes: true });
  const version = versions
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .at(0);
  if (!version) throw new Error('Android SDK 中没有 build-tools');
  const aaptPath = join(buildToolsRoot, version, process.platform === 'win32' ? 'aapt.exe' : 'aapt');
  await access(aaptPath, constants.X_OK);
  return aaptPath;
}

function runAapt(aaptPath, args) {
  const result = spawnSync(aaptPath, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `aapt 执行失败：${args.join(' ')}`);
  return result.stdout;
}

try {
  await access(apkPath, constants.R_OK);
  const aaptPath = await findAapt();
  const badging = runAapt(aaptPath, ['dump', 'badging', apkPath]);
  if (!badging.includes(`package: name='${expectedPackageName}'`)) {
    throw new Error(`APK 包名不是 ${expectedPackageName}`);
  }
  const manifest = runAapt(aaptPath, ['dump', 'xmltree', apkPath, 'AndroidManifest.xml']);
  for (const permission of ['android.permission.INTERNET', 'android.permission.CAMERA']) {
    if (!manifest.includes(permission)) throw new Error(`APK Manifest 缺少权限：${permission}`);
  }
  console.log(JSON.stringify({ apkPath, packageName: expectedPackageName, permissions: ['INTERNET', 'CAMERA'], verified: true }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
