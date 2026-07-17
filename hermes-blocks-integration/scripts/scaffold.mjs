#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE_DIR = path.join(SKILL_DIR, 'templates');
const VALUE_ARGS = new Set(['project-dir', 'agent-name', 'description', 'display-name', 'organization']);
const FLAG_ARGS = new Set(['help', 'dry-run']);

function usage() {
  return [
    'Create a generic Hermes-ready Blocks provider without overwriting existing files.',
    '',
    'Usage:',
    '  node scaffold.mjs --project-dir <dir> --agent-name <agent_name> \\',
    '    --description <one sentence> [--display-name <name>] [--organization <name>] [--dry-run]',
  ].join('\n');
}

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const equalsIndex = token.indexOf('=');
    const key = token.slice(2, equalsIndex >= 0 ? equalsIndex : undefined);
    const inlineValue = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : undefined;
    if (!VALUE_ARGS.has(key) && !FLAG_ARGS.has(key)) throw new Error(`Unknown option: --${key}`);
    if (values.has(key) || flags.has(key)) throw new Error(`Duplicate option: --${key}`);
    if (FLAG_ARGS.has(key)) {
      if (inlineValue !== undefined) throw new Error(`--${key} does not take a value`);
      flags.add(key);
      continue;
    }
    const value = inlineValue ?? argv[i + 1];
    if (!value || (inlineValue === undefined && value.startsWith('--'))) {
      throw new Error(`--${key} requires a value; use --${key}=<value> when it starts with --`);
    }
    values.set(key, value);
    if (inlineValue === undefined) i += 1;
  }
  return { values, flags };
}

function titleCase(value) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ');
}

function replaceAll(text, replacements) {
  let output = text;
  for (const [needle, value] of replacements) output = output.split(needle).join(value);
  return output;
}

function render(templateName, context) {
  const source = fs.readFileSync(path.join(TEMPLATE_DIR, templateName), 'utf8');
  return replaceAll(source, [
    ['<AGENT_NAME_JSON>', JSON.stringify(context.agentName)],
    ['<DISPLAY_NAME_JSON>', JSON.stringify(context.displayName)],
    ['<DESCRIPTION_JSON>', JSON.stringify(context.description)],
    ['<ORGANIZATION_JSON>', JSON.stringify(context.organization)],
    ['<AGENT_NAME>', context.agentName],
    ['<PACKAGE_NAME>', context.packageName],
  ]);
}

const { values, flags } = parseArgs(process.argv.slice(2));
if (flags.has('help')) {
  console.log(usage());
  process.exit(0);
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (!Number.isSafeInteger(nodeMajor) || nodeMajor < 22) {
  throw new Error(`Node.js 22 or newer is required; found ${process.versions.node}`);
}

const projectArg = values.get('project-dir');
const agentName = values.get('agent-name');
const description = values.get('description');
if (!projectArg || !agentName || !description) {
  console.error(usage());
  throw new Error('--project-dir, --agent-name, and --description are required');
}
if (!/^[a-zA-Z0-9_]+$/.test(agentName) || !/[a-zA-Z0-9]/.test(agentName)) {
  throw new Error('--agent-name must contain only letters, digits, and underscores');
}

const context = {
  agentName,
  packageName: agentName.toLowerCase().replace(/_/g, '-'),
  displayName: values.get('display-name') || titleCase(agentName),
  organization: values.get('organization') || 'Hermes',
  description,
};

const projectDir = path.resolve(projectArg);
if (fs.existsSync(projectDir) && !fs.statSync(projectDir).isDirectory()) {
  throw new Error(`--project-dir exists and is not a directory: ${projectDir}`);
}
const outputs = [
  ['handler.template.ts', 'handler.ts'],
  ['agent-card.template.json', 'agent-card.json'],
  ['package.template.json', 'package.json'],
  ['tsconfig.template.json', 'tsconfig.json'],
  ['env.template', '.env'],
  ['gitignore.template', '.gitignore'],
  ['call.template.mjs', 'call.mjs'],
];

const rendered = outputs.map(([templateName, targetName]) => {
  const content = render(templateName, context);
  if (targetName.endsWith('.json')) JSON.parse(content);
  return { targetName, content };
});

const collisions = rendered
  .map(({ targetName }) => path.join(projectDir, targetName))
  .filter((target) => fs.existsSync(target));
if (collisions.length) {
  throw new Error(`Refusing to overwrite existing files:\n${collisions.join('\n')}`);
}

if (flags.has('dry-run')) {
  console.log(JSON.stringify({
    status: 'dry-run',
    projectDir,
    agentName,
    files: rendered.map(({ targetName }) => targetName),
  }, null, 2));
  process.exit(0);
}

fs.mkdirSync(projectDir, { recursive: true });
for (const { targetName, content } of rendered) {
  const options = targetName === '.env' ? { flag: 'wx', mode: 0o600 } : { flag: 'wx' };
  fs.writeFileSync(path.join(projectDir, targetName), content, options);
}

console.log(JSON.stringify({
  status: 'created',
  projectDir,
  agentName,
  next: [
    'Add capability actions to agent-card.json and handler.ts.',
    'Run npm install, then npm run typecheck and npm run check.',
    'Authenticate with npm run login -- --write-env --dir <project-dir>.',
  ],
}, null, 2));
