import { currentEnv, verifyGroqKey, saveGroqKey, groqModel } from './groq-setup-core.mjs';
const checkOnly = process.argv.includes('--check');

function hiddenKeyPrompt() {
  return new Promise((resolveKey, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Abra um terminal interativo ou configure GROQ_API_KEY no ambiente.'));
      return;
    }
    let value = '';
    const wasRaw = Boolean(process.stdin.isRaw);
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolveKey(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003' || character === '\u001b') {
          finish(new Error('Configuração cancelada.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= '!' && character <= '~' && value.length < 256) value += character;
      }
    };
    process.stdout.write('Cole sua chave Groq e pressione Enter (entrada oculta): ');
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

try {
  const existing = await currentEnv();
  const key = process.env.GROQ_API_KEY || existing.values.GROQ_API_KEY ||
    (checkOnly ? '' : await hiddenKeyPrompt());
  if (!key) throw new Error('Chave ausente. Crie uma em https://console.groq.com/keys.');
  await verifyGroqKey(key);
  if (!checkOnly) await saveGroqKey(key, existing.content);
  console.log(checkOnly
    ? `Groq respondeu e disponibiliza ${groqModel}. Nenhum arquivo foi alterado.`
    : `Groq configurada no .env local com ${groqModel}. A chave não foi exibida.`);
  console.log('Ative Zero Data Retention na Groq Console em Data Controls.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na configuração da Groq.');
  process.exitCode = 1;
}
