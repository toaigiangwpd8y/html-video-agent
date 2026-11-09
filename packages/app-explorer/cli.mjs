#!/usr/bin/env node
import { runKnowledgeCli } from './tools/knowledge.mjs';

process.exitCode = await runKnowledgeCli(process.argv.slice(2));
