from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'resident-payments-console'}
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



    state=json.loads((ROOT/'artifacts/payment-upload-compatibility/state.json').read_text())
    NOTE='Upload response compatibility: SUBMIT_PAYMENT preserves success/data and also mirrors paymentSubmission, uploadUrl, documentId at the top level with errorResponse:null, matching the legacy make-resident-payment upload parser. CONFIRM_RECEIPT_UPLOAD mirrors paymentSubmission plus errorResponse:null. FETCH_OWN remains success/data only. Both parsers must PUT actual file bytes to the returned uploadUrl; pending_upload is not a stored receipt and does not change an unpaid payment or booking status. This additive compatibility change does not establish which parser the production Flutter app uses. '+state['status']+' Live test: '+state['live_http_test']+'.'
    matches=[]
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml';xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            first=i==1;ep=cells.get('G' if first else 'E','')
            if ep not in EPS:continue
            r=row.get('r');resp_col='T' if first else 'R';resp=cells.get(resp_col,'')
            # Modify only the complete submission/confirmation examples, keeping
            # the existing FETCH_OWN and error examples in their own wrappers.
            cleaned=re.sub(r'(?m)(?<=\s)//[^\n]*','',resp)
            decoder=json.JSONDecoder();replacements=[];end=0
            for m in re.finditer(r'(?m)^\s*\{',cleaned):
                start=cleaned.index('{',m.start())
                if start<end:continue
                obj,size=decoder.raw_decode(cleaned[start:]);end=start+size
                data=obj.get('data') if isinstance(obj,dict) else None
                if isinstance(data,dict) and 'paymentSubmission' in data:
                    obj['paymentSubmission']=copy.deepcopy(data['paymentSubmission'])
                    for key in ['uploadUrl','documentId']:
                        if key in data:obj[key]=data[key]
                    obj['errorResponse']=None
                    text=json.dumps(obj,indent=2)
                    text=re.sub(r'("receiptUploadStatus": "[^"\n]+",?)',r'\1 // Allowed: pending_upload, uploaded, not_provided',text)
                    replacements.append((start,end,text))
            for start,end,text in reversed(replacements):cleaned=cleaned[:start]+text+cleaned[end:]
            assert len(replacements)==2,('submission and confirmation examples expected',len(replacements))
            if cleaned.startswith('JSONC') and '\n\n' in cleaned:cleaned=cleaned.split('\n\n',1)[1]
            cleaned='JSONC response examples. Remove comments before sending JSON.\n\n'+cleaned
            desc_col='K' if first else 'I';audit_col='U' if first else 'T';status_col='Q' if first else 'N'
            desc=cells.get(desc_col,'').split('\n\nUpload response compatibility:')[0]+'\n\n'+NOTE
            audit=cells.get(audit_col,'').split('\n2026-11-18 upload compatibility:')[0]+'\n2026-11-18 upload compatibility: '+NOTE+'\nSource SHA-256: '+hashlib.sha256((ROOT/'supabase/functions/resident-payments-console/index.ts').read_bytes()).hexdigest()
            vals={desc_col:desc,resp_col:cleaned,('S' if first else 'Q'):'2026-11-18',audit_col:audit,status_col:cells.get(status_col,'').split('\nUpload compatibility deployment:')[0]+'\nUpload compatibility deployment: '+state['status']}
            for col,value in vals.items():xml=replace_cell(xml,col+r,value)
            matches.append([i,r,ep])
        if xml.encode()!=original[part]:changed[part]=xml.encode()
    assert matches

temp=BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as out:
    for info in infos:out.writestr(info,changed.get(info.filename,original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    for part,data in original.items():
        if part.endswith('.xml'):ET.fromstring(check.read(part))
        if part not in changed:assert check.read(part)==data,part
    count=0
    for i,r,ep in matches:
        root=ET.fromstring(check.read(f'xl/worksheets/sheet{i}.xml'))
        for c in root.findall(f'm:sheetData/m:row[@r="{r}"]/m:c',NS):
            if c.get('r') not in [('M' if i==1 else 'K')+r,('T' if i==1 else 'R')+r]:continue
            v=re.sub(r'(?m)(?<=\s)//[^\n]*','',text_of(c));decoder=json.JSONDecoder();pos=0
            for m in re.finditer(r'(?m)^\s*\{',v):
                start=v.index('{',m.start())
                if start<pos:continue
                _,size=decoder.raw_decode(v[start:]);count+=1;pos=start+size
    assert count>=6,count
temp.replace(BOOK)
report={'updated_rows':matches,'jsonc_examples_validated':count,'unrelated_package_parts_preserved':True,'deployment':state}
(ROOT/'artifacts/payment-upload-compatibility/workbook-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
