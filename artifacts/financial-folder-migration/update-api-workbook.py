from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'resident-payments-console','make-resident-payment','resident-facility-booking','admin-payments-console','verify-payment','get-payments-list','get-facility-bookings','generate-payment-receipt'}
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



    STORAGE='Storage contract: bucket society-documents; payment proofs use <SOCIETY_REGISTRATION_NUMBER>/financial/<FILE_NAME> (lowercase, case-sensitive). This is a folder in the existing bucket, not a new bucket. The old Financial folder was consolidated: 43 files copied and verified, 42 document references updated, originals removed. Stored payment/document references determine retrieval paths; never construct paths from a resident phone number.'
    ROLE={
      'resident-payments-console':'SUBMIT_PAYMENT prepares an uploadUrl; PUT raw file bytes with the actual image Content-Type to that exact URL. A saved filename/document record alone is not a completed upload. A completed upload sets eligible payments to UNDER REVIEW through the deployed database trigger; CONFIRM_RECEIPT_UPLOAD remains supported. FETCH_OWN returns receiptUrl only after the file exists; missing files return null.',
      'make-resident-payment':'SUBMIT_PAYMENT prepares an uploadUrl; PUT raw file bytes with the actual image Content-Type. CONFIRM_RECEIPT_UPLOAD verifies stored proof. Retain the legacy top-level response wrapper, including errorResponse; the URL alone does not complete the upload.',
      'resident-facility-booking':'book can prepare a proof uploadUrl and SSP_Document reference in the lowercase financial folder. PUT the binary file after booking; creation still responds waiting_payment before upload. list_bookings returns the linked payment status and does not return a receipt image URL. Do not interpret receipt upload as bank verification or automatic booking approval.',
      'admin-payments-console':'VERIFY_PAYMENT accepts JSON or multipart/form-data. Optional receiptImage binary is stored in the lowercase financial folder. FETCH_ALL resolves SSP_Payment.receipt_url then document references and returns a signed imageUrl only for an existing object; missing proof is N/A. VERIFY and REJECT retain their current status changes and response wrappers.',
      'verify-payment':'JSON or multipart/form-data; optional receiptImage binary is stored in the lowercase financial folder. receipt_url is a public reference only when this operation uploads a file; without a new upload it is null. VERIFY/REJECT behavior and existing facility-booking workflow are unchanged.',
      'get-payments-list':'Read-only payment list. Resolve the saved SSP_Payment.receipt_url and SSP_Document.s3_path references, including migrated lowercase paths. imageUrl is a signed view URL only for a stored object; otherwise N/A. No upload operation.',
      'get-facility-bookings':'Read-only admin facility booking list. Resolve linked document/payment proof references in the lowercase folder. receiptImageUrl is a signed view URL only when the file exists; receiptUploadStatus distinguishes uploaded, missing, not_provided, unverified. Legacy alternate-case lookup remains compatibility logic; no upload writes uppercase Financial.',
      'generate-payment-receipt':'Paid-payment receipt download can read proof references from financial. A stored image proof is embedded into a PDF; generated PDF artifacts for responseFormat=url remain in society-documents/receipts/<PAYMENT_UUID>_<RECEIPT_FILE>. Do not relocate PDF generation to financial. Default responseFormat=file returns application/pdf binary without changing proof metadata. list=true browses resident payment history with optional filters; downloads require a paid payment.'
    }
    project='https://<PROJECT_REF>.supabase.co'
    proof=project+'/storage/v1/object/sign/society-documents/<SOCIETY_REGISTRATION_NUMBER>/financial/<TIMESTAMP>_receipt.jpg?token=<SIGNED_TOKEN>'
    upload=project+'/storage/v1/object/upload/sign/society-documents/<SOCIETY_REGISTRATION_NUMBER>/financial/<TIMESTAMP>_receipt.jpg?token=<UPLOAD_TOKEN>'
    def example(label,obj):
        out=json.dumps(obj,indent=2)
        for field,allowed in {'responseFormat':'file, url','mode':'list, url','source':('stored, generatable' if obj.get('mode')=='list' else 'stored, generated')}.items():
            out=re.sub(r'("'+field+r'": "[^"\n]+",?)',r'\1 // Allowed: '+allowed,out)
        return label+' (JSONC):\n'+out
    receipt_requests='\n\n'.join([
      example('LIST (filters and pagination optional)',{'list':True,'filters':{'paymentStatus':'paid','startDate':'2026-11-01T00:00:00+05:30','endDate':'2026-11-30T23:59:59+05:30','searchQuery':'PAY-EXAMPLE'},'pagination':{'page':1,'pageSize':20}}),
      example('Direct PDF download',{'paymentId':'<PAYMENT_UUID_OR_PAYMENT_ID>','responseFormat':'file'}),
      example('Signed PDF URL',{'paymentId':'<PAYMENT_UUID_OR_PAYMENT_ID>','responseFormat':'url'})])
    receipt_responses='\n\n'.join([
      example('LIST HTTP 200',{'success':True,'mode':'list','receipts':[{'payRecId':'<PAYMENT_UUID>','paymentId':'PAY-EXAMPLE','paymentStatus':'paid','amount':500,'createdAt':'2026-11-18T05:45:00Z','hasReceipt':True,'source':'stored','fileName':'receipt.jpg'}],'pagination':{'page':1,'pageSize':20,'total':1,'totalPages':1}}),
      'Direct download HTTP 200 (non-JSON):\nContent-Type: application/pdf\nContent-Disposition: attachment; filename="Receipt_PAY-EXAMPLE.pdf"\nContent-Length: <ACTUAL_PDF_BYTE_LENGTH>\nCache-Control: private, no-store\nX-Receipt-Source: generated\nBody: PDF binary bytes, not a JSON response.',
      example('Signed generated PDF URL HTTP 200',{'success':True,'mode':'url','source':'generated','payRecId':'<PAYMENT_UUID>','paymentId':'PAY-EXAMPLE','fileName':'Receipt_PAY-EXAMPLE.pdf','downloadUrl':project+'/storage/v1/object/sign/society-documents/receipts/<PAYMENT_UUID>_Receipt_PAY-EXAMPLE.pdf?token=<SIGNED_TOKEN>','expiresIn':300}),
      example('Unpaid download HTTP 400',{'success':False,'errorResponse':{'errorCode':'INVALID_STATUS','message':'Receipt is only available for paid payments. Current status: unpaid.','timestamp':'2026-11-18T06:30:00Z'}})])
    matches=[]
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml';xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            first=i==1;ep=cells.get('G' if first else 'E','')
            if ep not in EPS:continue
            r=row.get('r');reqcol='M' if first else 'K';respcol='T' if first else 'R';desccol='K' if first else 'I';curlcol='R' if first else 'P'
            req=cells.get(reqcol,'');resp=cells.get(respcol,'')
            if ep=='generate-payment-receipt':req=receipt_requests;resp=receipt_responses
            else:
                resp=resp.replace('<SIGNED_RECEIPT_URL>',proof).replace('<SIGNED_UPLOAD_URL>',upload).replace('<SIGNED_UPLOAD_URL_FOR_society-documents/SOCIETY/financial/TIMESTAMP_payment-proof.jpg>',upload).replace('<OBJECT_PATH>','<SOCIETY_REGISTRATION_NUMBER>/financial/<TIMESTAMP>_receipt.jpg')
            if ep=='admin-payments-console' and 'REJECT_PAYMENT example' not in resp:
                resp+='\n\n'+example('REJECT_PAYMENT example HTTP 200',{'success':True,'data':{'success':True,'paymentStatus':'Rejected','message':'Payment rejected successfully.','receipt_url':None,'bookingId':None}})
            if ep in {'admin-payments-console','verify-payment'} and 'Multipart receiptImage upload' not in req:
                req+='\n\nMultipart receiptImage upload (non-JSON):\nContent-Type: multipart/form-data; boundary=<AUTO_GENERATED_BOUNDARY>\nForm fields: societyRegistrationNumber=<SOCIETY_REGISTRATION_NUMBER>, paymentId=<PAYMENT_ID_OR_UUID>, action=VERIFY (Allowed: VERIFY, REJECT), receiptImage=@receipt.jpg (binary image/jpeg). For admin-payments-console also supply actionType=VERIFY_PAYMENT. rejectionReason is optional for REJECT. Let the HTTP library generate the multipart boundary.'
            if not req.startswith('JSONC'):req='JSONC illustrative examples; remove // comments before sending JSON.\n\n'+req
            if not resp.startswith('JSONC'):resp='JSONC illustrative examples; remove // comments before sending JSON. Non-JSON/binary responses are explicitly labeled.\n\n'+resp
            desc=cells.get(desccol,'').split('\n\nCanonical payment proof storage:')[0]+'\n\nCanonical payment proof storage: '+STORAGE+' '+ROLE[ep]
            req=req.split('\n\n// '+ROLE[ep])[0]+'\n\n// '+ROLE[ep]
            resp=resp.split('\n\nStorage/retrieval notes:')[0]+'\n\nStorage/retrieval notes: '+ROLE[ep]
            curl=cells.get(curlcol,'')
            if ep in {'resident-payments-console','make-resident-payment','resident-facility-booking'}:
                curl=curl.split('\n\nCanonical binary upload:')[0]+'\n\nCanonical binary upload:\ncurl --request PUT "'+upload+'" --header "Content-Type: image/jpeg" --data-binary @receipt.jpg\nUse the uploadUrl returned by the API verbatim; this illustrative URL must not be constructed by the client. Check successful upload before claiming proof submission, then re-fetch payment status.'
            audit=cells.get('U' if first else 'T','').split('\n2026-11-18 storage normalization review:')[0]+'\n2026-11-18 storage normalization review: '+STORAGE+' '+ROLE[ep]+' Validation: live folder migration verified 43 destination files and 42 document references; disposable resident HTTP upload/download regression passed. These results do not constitute live tests of every listed endpoint. This task changes documentation only; existing active upload code already uses lowercase financial. No Edge Function redeployment.'
            vals={desccol:desc,reqcol:req,respcol:resp,curlcol:curl,('S' if first else 'Q'):'2026-11-18',('U' if first else 'T'):audit}
            if ep=='generate-payment-receipt':
                vals['O' if first else 'M']='responseFormat: file, url (default file); list=true enables list mode; optional filters.paymentStatus/startDate/endDate/searchQuery; pagination.page/pageSize. Download requires a paid payment; list mode can browse unpaid history. Financial proof paths and receipts PDF paths are server-managed.'
            for col,value in vals.items():xml=replace_cell(xml,col+r,value)
            matches.append([i,r,ep])
        if xml.encode()!=original[part]:changed[part]=xml.encode()
    assert {ep for _,_,ep in matches}==EPS,matches

temp=BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as out:
    for info in infos:out.writestr(info,changed.get(info.filename,original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    for part,data in original.items():
        if part.endswith('.xml'):ET.fromstring(check.read(part))
        if part not in changed:assert check.read(part)==data,part
    examples=0
    for i,r,ep in matches:
        root=ET.fromstring(check.read(f'xl/worksheets/sheet{i}.xml'))
        for c in root.findall(f'm:sheetData/m:row[@r="{r}"]/m:c',NS):
            if c.get('r') not in [('M' if i==1 else 'K')+r,('T' if i==1 else 'R')+r]:continue
            v=text_of(c)
            v=re.sub(r'(?m)(?<=\s)//[^\n]*','',v)
            decoder=json.JSONDecoder();pos=0
            for m in re.finditer(r'(?m)^\s*\{',v):
                start=v.index('{',m.start())
                if start<pos:continue
                obj,length=decoder.raw_decode(v[start:]);examples+=1;pos=start+length
    assert examples>=35,examples
temp.replace(BOOK)
report={'updated_rows':matches,'endpoint_count':len(EPS),'jsonc_examples_validated':examples,'unrelated_package_parts_preserved':True,'bucket':'society-documents','proof_folder':'<SOCIETY_REGISTRATION_NUMBER>/financial/','generated_pdf_folder':'receipts/','edge_function_changes':False,'redeployed':False}
(ROOT/'artifacts/financial-folder-migration/api-workbook-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
