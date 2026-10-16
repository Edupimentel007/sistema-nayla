import express, { type Request, type Response } from 'express';
import { db, id } from './db.js';

type Row = Record<string, any>;
const maxLogoBytes = 1024 * 1024;
const mimeTypes = ['image/png', 'image/jpeg', 'image/webp'];

function validImage(bytes: Buffer, mimeType: string) {
  if (mimeType === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg')
    return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mimeType === 'image/webp')
    return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export function businessLogoUrl(businessId: string, slug: string) {
  const row = db.prepare('SELECT version FROM business_logos WHERE business_id=?')
    .get(businessId) as { version: string } | undefined;
  return row ? `/api/public/${encodeURIComponent(slug)}/logo?v=${encodeURIComponent(row.version)}` : null;
}

export const parseLogo = express.raw({ type: mimeTypes, limit: maxLogoBytes });

export function uploadBusinessLogo(req: Request, res: Response) {
  const businessId = (res.locals.user as Row).business_id as string;
  const mimeType = (req.get('content-type') || '').split(';')[0].toLowerCase();
  const bytes = req.body;
  if (!mimeTypes.includes(mimeType) || !Buffer.isBuffer(bytes) || !bytes.length ||
    bytes.length > maxLogoBytes || !validImage(bytes, mimeType))
    return res.status(400).json({ error: 'Envie uma imagem PNG, JPEG ou WebP válida de até 1 MB.' });
  const business = db.prepare('SELECT slug FROM businesses WHERE id=?').get(businessId) as Row;
  db.prepare(`INSERT INTO business_logos(business_id,mime_type,image_data,version)
    VALUES(?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET mime_type=excluded.mime_type,
    image_data=excluded.image_data,version=excluded.version,updated_at=CURRENT_TIMESTAMP`)
    .run(businessId, mimeType, bytes, id());
  res.json({ logoUrl: businessLogoUrl(businessId, business.slug) });
}

export function deleteBusinessLogo(_req: Request, res: Response) {
  const businessId = (res.locals.user as Row).business_id as string;
  db.prepare('DELETE FROM business_logos WHERE business_id=?').run(businessId);
  res.json({ logoUrl: null });
}

export function publicBusinessLogo(req: Request, res: Response) {
  const row = db.prepare(`SELECT l.mime_type,l.image_data FROM business_logos l
    JOIN businesses b ON b.id=l.business_id WHERE b.slug=?`)
    .get(req.params.slug) as { mime_type: string; image_data: Buffer } | undefined;
  if (!row) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type(row.mime_type).send(row.image_data);
}
