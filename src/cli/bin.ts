#!/usr/bin/env node
import { main } from "./index.js";

const [, , command, ...rest] = process.argv;
process.exit(main(command, rest));
