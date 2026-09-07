import QRCode from 'qrcode';
export default async function handler(req,res){
  const proto=(req.headers['x-forwarded-proto']||'https').split(',')[0];
  const host=req.headers.host;
  const url=`${proto}://${host}/registro`;
  const svg=await QRCode.toString(url,{type:'svg',margin:1,width:800,errorCorrectionLevel:'M'});
  res.setHeader('Content-Type','image/svg+xml');
  res.setHeader('Cache-Control','public, max-age=3600');
  res.status(200).send(svg);
}
