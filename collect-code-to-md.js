const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const config = {
  rootDir: process.cwd(),
  // 기본 출력 파일 이름(여러 개로 나눌 경우 접미사가 붙습니다)
  outputFile: 'project-code-collection.md',
  // 포함할 확장자
  includeExtensions: [
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.java',
    '.kt',
    '.kts',
    '.py',
    '.go',
    '.rs',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.html',
    '.css',
    '.scss',
    '.json',
    '.yml',
    '.yaml'
  ],
  // 완전히 제외할 디렉터리명
  excludeDirs: [
    '.git',
    'node_modules',
    '.next',
    'dist',
    'build',
    'out',
    'coverage',
    'target',
    '.idea',
    '.vscode',
    '.gradle',
    '.turbo',
    '.github',
    'docs',
    'builds'
  ],
  // 제외할 파일 확장자 (includeExtensions에 있어도 우선 제외)
  excludeExtensions: [
    '.sh',
    '.jar',
    '.class',
    '.jpg'
  ],
  // 한 파일 최대 크기 (바이너리/초대형 파일 방지)
  maxFileSizeBytes: 2 * 1024 * 1024,
  // 출력할 Markdown 파일 개수 (1이면 단일 파일)
  maxOutputFiles: 5,
  // 첫 번째 출력 파일을 Kwrite로 열지 여부
  openInKwrite: false,
  // 출력 파일들이 있는 디렉터리를 Dolphin으로 열지 여부
  openInDolphin: true,
};

function shouldExcludeDir(name) {
  if (config.excludeDirs.includes(name)) return true;
  // 숨김 디렉터리는 기본 제외(.github 등 예외는 위에서 명시)
  if (name.startsWith('.') && !config.excludeDirs.includes(name)) return true;
  return false;
}

function shouldIncludeFile(name, fullPath, relPath) {
  if (relPath === config.outputFile || name === config.outputFile) return false;
  const ext = path.extname(name).toLowerCase();
  if (config.excludeExtensions.includes(ext)) return false;
  if (!config.includeExtensions.includes(ext)) return false;
  return true;
}

async function walk(dir, result) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(config.rootDir, fullPath);
    if (entry.isDirectory()) {
      if (shouldExcludeDir(entry.name)) continue;
      await walk(fullPath, result);
    } else if (entry.isFile()) {
      if (!shouldIncludeFile(entry.name, fullPath, relPath)) continue;
      result.push({ fullPath, relPath });
    }
  }
}

async function buildMarkdown(files) {
  const parts = [];
  parts.push('# Project Code Snapshot\n\n');
  parts.push(`Generated at ${new Date().toISOString()}\n`);
  for (const file of files) {
    const stat = await fs.stat(file.fullPath);
    if (stat.size > config.maxFileSizeBytes) continue;
    const content = await fs.readFile(file.fullPath, 'utf8');
    const ext = path.extname(file.fullPath).slice(1);
    const lang = ext || '';
    parts.push('\n---\n\n');
    parts.push(`## ${file.relPath}\n\n`);
    const safeContent = content.replace(/```/g, '``\\`');
    parts.push('```' + lang + '\n' + safeContent + '\n```\n');
  }
  return parts.join('');
}

async function openInKwrite(outPath) {
  if (!config.openInKwrite) return;
  try {
    const kwrite = spawn('kwrite', [outPath], {
      detached: true,
      stdio: 'ignore',
    });
    kwrite.on('error', (err) => {
      console.error('Failed to open Kwrite:', err && err.message ? err.message : err);
    });
    kwrite.unref();
  } catch (err) {
    console.error('Failed to spawn Kwrite:', err && err.message ? err.message : err);
  }
}

async function openInDolphin(dirPath) {
  if (!config.openInDolphin) return;
  try {
    const dolphin = spawn('dolphin', [dirPath], {
      detached: true,
      stdio: 'ignore',
    });
    dolphin.on('error', (err) => {
      console.error('Failed to open Dolphin:', err && err.message ? err.message : err);
    });
    dolphin.unref();
  } catch (err) {
    console.error('Failed to spawn Dolphin:', err && err.message ? err.message : err);
  }
}

function getOutputFileName(baseName, index, total) {
  if (total === 1) return baseName;
  const ext = path.extname(baseName); // .md
  const name = path.basename(baseName, ext); // project-code-collection
  return `${name}-${index + 1}${ext}`;
}

async function writeOutputMarkdowns(allFiles) {
  const totalFiles = allFiles.length;
  if (totalFiles === 0) {
    console.log('No files matched filters. Nothing to write.');
    return [];
  }

  const outputCount = Math.max(1, Math.min(config.maxOutputFiles || 1, totalFiles));
  const filesPerOutput = Math.ceil(totalFiles / outputCount);

  const outputPaths = [];

  for (let i = 0; i < outputCount; i++) {
    const start = i * filesPerOutput;
    if (start >= totalFiles) break;
    const end = Math.min(start + filesPerOutput, totalFiles);
    const slice = allFiles.slice(start, end);
    const markdown = await buildMarkdown(slice);
    const fileName = getOutputFileName(config.outputFile, i, outputCount);
    const outPath = path.join(config.rootDir, fileName);
    await fs.writeFile(outPath, markdown, 'utf8');
    outputPaths.push(outPath);
  }

  return outputPaths;
}

async function main() {
  try {
    const files = [];
    await walk(config.rootDir, files);

    const outputPaths = await writeOutputMarkdowns(files);
    if (outputPaths.length === 0) {
      return;
    }

    console.log(`Collected ${files.length} source files into ${outputPaths.length} markdown file(s):`);
    for (const p of outputPaths) {
      console.log('  - ' + path.relative(config.rootDir, p));
    }

    // 첫 번째 출력 파일을 Kwrite로 열기
    await openInKwrite(outputPaths[0]);
    // 출력 파일들이 있는 디렉터리를 Dolphin으로 열기 (모든 출력 파일이 같은 디렉터리에 있으므로 한 번만 호출)
    await openInDolphin(path.dirname(outputPaths[0]));
  } catch (err) {
    console.error('Failed to collect code to markdown:', err);
    process.exitCode = 1;
  }
}

main();
