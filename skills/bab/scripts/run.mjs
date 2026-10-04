#!/usr/bin/env node
import {main} from './cli.mjs';
try {console.log(JSON.stringify(await main(), null, 2));}
catch (error) {console.error(JSON.stringify({error: error.message})); process.exitCode = 1;}
