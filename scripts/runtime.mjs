// A tiny Bun launcher; application modules remain outside the executable so updates take effect.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleFile = path.resolve(path.dirname(process.execPath), '..', 'scripts', 'cli.mjs');
try {
  const {main} = await import(pathToFileURL(moduleFile).href);
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {console.error(JSON.stringify({error: error.message})); process.exitCode = 1;}
