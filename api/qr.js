import QRCode from 'qrcode';

export default async function handler(req,res){
  const url='https://bhg-control-personal.vercel.app/registro';

  const svg=await QRCode.toString(url,{
    type:'svg',
    margin:1,
    width:800,
    errorCorrectionLevel:'M'
  });

  res.setHeader('Content-Type','image/svg+xml');
  res.setHeader('Cache-Control','no-store');
  res.status(200).send(svg);
}
