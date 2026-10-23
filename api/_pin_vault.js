import crypto from 'node:crypto';
// El PIN anterior solo se guardó como hash irreversible: no es recuperable.
// PIN_VAULT_KEY debe ser una clave secreta larga configurada en Vercel.
function key(){
  const secret=process.env.PIN_VAULT_KEY;
  if(!secret || secret.length<32) throw new Error('Configura PIN_VAULT_KEY (mínimo 32 caracteres) en Vercel para consultar PIN de empleados');
  return crypto.createHash('sha256').update(secret).digest();
}
export function encryptPin(pin){
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const data=Buffer.concat([cipher.update(String(pin),'utf8'),cipher.final()]);
  return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
}
export function decryptPin(value){
  const [iv,tag,data]=String(value).split('.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));
  decipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');
}
