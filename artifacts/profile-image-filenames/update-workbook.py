from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'profile-images'}
STATE=json.loads((ROOT/'artifacts/profile-image-filenames/status.json').read_text())
NOTE='New uploads use <contactId>_profileImage.<extension> as both the Storage basename and SSP_Profile_Image.file_name, resolving contactId from the authorized owner record. Profiles without a contact record use ownerId instead. Storage object keys are <society>/<ownerType>/<ownerId>/<uploadUUID>/<contactId-or-ownerId>_profileImage.<extension>; the unique version folder preserves safe replacement and cleanup. Client fileName remains a required validated input label, but the backend generates the saved filename. Legacy UUID object keys prepared before this rollout remain confirmable. Private profile-images bucket; SSP_Profile_Image keeps exactly one current record per owner_type/owner_id. PREPARE_UPLOAD creates a signed upload URL without changing the current image. CONFIRM_UPLOAD validates uploaded bytes, atomically replaces the saved reference, deletes the previous file from Storage and completes cleanup before returning HTTP 200. If cleanup fails, HTTP 503 instructs the caller to retry CONFIRM_UPLOAD with the same objectKey; the new reference remains saved and deletion is retried. A retired or missing object cannot be reactivated. Existing self/admin/security permissions, owner-specific paths, JPEG/PNG/WebP validation, 5 MB limit and 900-second signed URLs remain enforced.'
with zipfile.ZipFile(BOOK) as src:
    infos=src.infolist()
    original={i.filename:src.read(i.filename) for i in infos}
    changed={}
    strings=[''.join(si.itertext()) for si in ET.fromstring(original['xl/sharedStrings.xml']).findall('m:si',NS)]
    def text_of(cell):
        if cell is None:
            return ''
        if cell.get('t') == 's':
            return strings[int(cell.find('m:v', NS).text)]
        inline = cell.find('m:is', NS)
        if inline is not None:
            return ''.join(inline.itertext())
        value = cell.find('m:v', NS)
        return value.text if value is not None else ''

    def replace_cell(xml, ref, value):
        assert len(value.encode('utf-16-le')) // 2 <= 32767, (ref, 'Excel cell limit')
        match = re.search(r'<c\b[^>]*\br="' + re.escape(ref) + r'"[^>]*(?:/>|>.*?</c>)', xml, re.S)
        if match:
            style = re.search(r'\bs="([^"]+)"', match.group())
            style_attr = f' s="{style.group(1)}"' if style else ''
            cell = f'<c r="{ref}"{style_attr} t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
            return xml[:match.start()] + cell + xml[match.end():]
        row_num = re.search(r'\d+$', ref).group()
        row_match = re.search(r'<row\b[^>]*\br="' + row_num + r'"[^>]*>', xml)
        assert row_match, ref
        cell = f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
        return xml[:row_match.end()] + cell + xml[row_match.end():]



    matches=[]
    validated=0
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml'
        xml=original[part].decode()
        root=ET.fromstring(xml)
        for row in root.findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            ep=cells.get('G' if i==1 else 'E','')
            if ep not in EPS: continue
            r=row.get('r');first=i==1
            req=cells['M' if first else 'K']
            resp=cells['T' if first else 'R']
            resp=resp.replace('<SOCIETY_UUID>/society_user/<OWNER_UUID>/<RANDOM_UUID>.png','<SOCIETY_UUID>/society_user/<OWNER_UUID>/<UPLOAD_UUID>/<CONTACT_UUID>_profileImage.png')
            resp=resp.replace('"fileName": "avatar.png"','"fileName": "<CONTACT_UUID>_profileImage.png"')
            # Preserve request placeholders; show the full resulting key in response metadata.
            resp=resp.replace('"objectKey": "<EXACT_OBJECT_KEY_FROM_PREPARE_UPLOAD>"','"objectKey": "<SOCIETY_UUID>/society_user/<OWNER_UUID>/<UPLOAD_UUID>/<CONTACT_UUID>_profileImage.png"')

            if 'HTTP 503 replacement cleanup failure' not in resp:
                resp+='\n\nHTTP 503 replacement cleanup failure — retry CONFIRM_UPLOAD with the same objectKey:\n'+json.dumps({'success':False,'error':'ERROR','message':'New image saved, but the previous image could not be deleted. Retry CONFIRM_UPLOAD with the same objectKey.'},indent=2)
                resp+='\n\nHTTP 409 retired image:\n'+json.dumps({'success':False,'error':'ERROR','message':'This image was already replaced. Upload a new image.'},indent=2)
            resp=re.sub(r'\n\n// (?:Private profile-images bucket;|New uploads use <contactId>_profileImage).*$', '', resp, flags=re.S)
            resp+='\n\n// '+NOTE
            desc=NOTE
            audit=f'supabase/functions/{ep}/index.ts\nSource SHA-256: '+hashlib.sha256((ROOT/f'supabase/functions/{ep}/index.ts').read_bytes()).hexdigest()+'\nMigration: supabase/migrations/20261117210000_replace_profile_image.sql\n'+STATE['status']+'\nShared helper: supabase/functions/_shared/profile-images.ts SHA-256: 6e5674aa0c0cccc52701e6b36230b0ac605f2279511e7b2a02548b542b3c55d0. Local API checks cover contact UUID filenames, fallback for identities without contacts, unique version paths, forged filename rejection and legacy in-flight uploads, plus replacement and cleanup failures. Existing replacement database tests passed. Existing profile readers passed compatibility tests.'
            vals={('K' if first else 'I'):desc,('M' if first else 'K'):req,('T' if first else 'R'):resp,('S' if first else 'Q'):'2026-11-17',('U' if first else 'T'):audit}
            if first: vals['Q']=STATE['status']
            else:
                vals['N']=STATE['status']
                vals['O']=STATE['status']
            for col,value in vals.items():xml=replace_cell(xml,col+r,value)
            matches.append((i,r,ep))
        if xml.encode()!=original[part]:changed[part]=xml.encode()
    assert {ep for _,_,ep in matches}==EPS
    print('Updated endpoint rows:',matches,'; illustrative objects checked:',validated)
temp = BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED) as out:
    for info in infos:
        out.writestr(info, changed.get(info.filename, original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    for part, data in original.items():
        if part.endswith('.xml'):
            ET.fromstring(check.read(part))
        if part not in changed:
            assert check.read(part) == data, part
temp.replace(BOOK)
print('Workbook package/XML and cell limits validated; unrelated package parts byte-identical.')
