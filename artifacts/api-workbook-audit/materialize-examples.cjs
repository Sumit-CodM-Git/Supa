// Build illustrative response objects from TypeScript return expressions; never execute APIs.
const ts=require('/private/tmp/ssp-api-workbook-audit/node_modules/typescript');
const fs=require('fs');
const facts=JSON.parse(fs.readFileSync('artifacts/api-workbook-audit/contracts.json'));
const files=Object.values(facts).map(c=>c.file);
const program=ts.createProgram(files,{noResolve:true,noLib:true,target:ts.ScriptTarget.Latest,skipLibCheck:true});
const checker=program.getTypeChecker();
const result={};
const UUID='00000000-0000-4000-8000-000000000001';
for(const [api,fact]of Object.entries(facts)){
 const sf=program.getSourceFile(fact.file),variables=new Map(),functions=new Map(),pushes=new Map(),assignments=new Map(),candidates=[];
 const unresolved=new Set();let currentNode;const rowBusy=new Set();
 const symbolKey=n=>{const sym=checker.getSymbolAtLocation(n);return sym?.valueDeclaration?.pos??text(n)};
 const text=n=>n?.getText(sf)??'';
 function scan(n){
  if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)){let a=variables.get(n.name.text)??[];a.push(n);variables.set(n.name.text,a)}
  if(ts.isFunctionDeclaration(n)&&n.name)functions.set(n.name.text,n);
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken){const key=text(n.left);const a=assignments.get(key)??[];a.push(n);assignments.set(key,a)}
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='push'){
   let key=symbolKey(n.expression.expression);const a=pushes.get(key)??[];a.push(...n.arguments);pushes.set(key,a)
  }
  ts.forEachChild(n,scan);
 }
 scan(sf);
 function concrete(key='',hint=''){
  const k=key.split('.').at(-1).replace(/\[.*\]/g,'');
  if(/^(page|pageSize|limit|totalPages|totalCount|totalRecords|total|count|clearedAssignments|imageCount|staffCount|devices_total|success_count|attempt|version|durationMs)$/.test(k))return /limit|Size/.test(k)?20:1;
  if(/amount|charges|price|deposit|balance|payable|fee|rating/i.test(k))return /rating/i.test(k)?4:1500;
  if(/^(is|has|can|requires)[A-Z_]|^active$|^success$|^updated$|^preApproved$|^otpVerified$|^recurring$|^is_uploaded$/.test(k))return true;
  if(/deletedAt|deleted_at|rejectionReason|rejection_reason/.test(k))return null;
  if(/flatType$|flat_type$/.test(k))return '2 BHK';
  if(/parkingSlot|parking_slot/.test(k))return 'P-101';
  if(/phone/i.test(k))return '9000000000';
  if(/email/i.test(k))return 'person@example.com';
  if(/^(flatNumber|flat_number|unitFlatNumber|unit_flat_number|unitNumber)$/.test(k))return '101';
  if(/towerName|tower_name/.test(k))return 'Tower A';
  if(/blockName|block_name/.test(k))return 'Block A';
  if(/societyName|society_name/.test(k))return 'Example Society';
  if(/registrationNumber|registration_number/.test(k))return 'EXAMPLE-REG-001';
  if(/fileType|file_type|mime/i.test(k))return 'image/jpeg';
  if(/fileName|file_name/.test(k))return 'example.jpg';
  if(/fileSize|file_size/.test(k))return 102400;
  if(/url|signedUrl|s3_path/i.test(k))return 'https://example.com/example-file';
  if(/objectKey|object_key/.test(k))return 'example-society/documents/example.jpg';
  if(/created|updated|date|time|published|expiry|expires/i.test(k)&&!/status|stage|type/i.test(k))return '2026-11-11T10:00:00+05:30';
  if(/id$|_id$|^recordId$|^society$|^tower$|^block$|^contact$/i.test(k))return UUID;
  if(/otp/i.test(k))return '123456';
  if(/status/i.test(k))return /payment/i.test(k)?'Paid':/approval/i.test(k)?'Approved':'active';
  if(/ownership/i.test(k))return 'primary';
  if(/role/i.test(k))return 'resident';
  if(/name|Name|title/i.test(k))return 'Example '+(k||'record');
  if(/message/i.test(k))return 'Operation completed successfully.';
  if(/description|purpose|note/i.test(k))return 'Example details';
  if(/currency/i.test(k))return 'INR';
  if(/token/i.test(k))return '<EXAMPLE_TOKEN>';
  if(/^[A-Z_]+$/.test(hint))return hint;
  return 'Example value';
 }
 function typeExample(type,key,seen=new Set()){
  if(type==null)return concrete(key);
  if(typeof type==='string'){
   if(seen.has(type))return concrete(key);seen=new Set(seen).add(type);
   if(fact.interfaces[type])return typeExample(fact.interfaces[type],key,seen);
   if(fact.types[type])return typeExample(fact.types[type],key,seen);
   if(type.startsWith('"')){try{return JSON.parse(type)}catch{}}
   if(type==='number')return /id/i.test(key)?1:1500;
   if(type==='boolean')return true;
   if(type==='null')return null;
   if(type.startsWith('typeof ')){const values=fact.enums[type.split(' ')[1].split('[')[0]];if(values?.length)return values[0]}
   return concrete(key)
  }
  if(Array.isArray(type))return[typeExample(type[0],key,seen)];
  if(type.union)return typeExample(type.union.find(x=>x!=='null'&&x!=='undefined')??'null',key,seen);
  return Object.fromEntries(Object.entries(type).map(([k,v])=>[k.replace(/\?$/,''),typeExample(v,k.replace(/\?$/,''),seen)]));
 }
 function rowExample(key){
  if(rowBusy.has(key))return {id:UUID,name:'Example record'};rowBusy.add(key);

  const types=Object.keys(fact.interfaces);let candidate;
  const priorities=/member/i.test(key)?['MemberResponse','FormattedMember']:/booking/i.test(key)?['BookingData','FacilityBookingsApproval']:/visitor/i.test(key)?['VisitorOtpResponse','FormattedVisitor']:/payment/i.test(key)?['PaymentRecord']:/facilit/i.test(key)?['FormattedFacility']:/complaint/i.test(key)?['ComplaintsApproval','FormattedComplaint']:/document/i.test(key)?['FormattedDocument']:/staff/i.test(key)?['FormattedStaff']:[];
  candidate=priorities.find(t=>fact.interfaces[t]);
  candidate??=types.find(t=>/^Formatted/.test(t));
  if(candidate)return typeExample(fact.interfaces[candidate],key);
  const push=[...pushes.entries()].find(([k])=>String(k).toLowerCase().includes(key.toLowerCase()));
  if(push?.[1]?.length)return ev(push[1][0],key,{},new Set(),1);
  unresolved.add('array:'+key);return {id:UUID,name:'Example record'};
 }
 function selectRow(selection){
  const parts=[];let begin=0,level=0;for(let i=0;i<selection.length;i++){if(selection[i]==='(')level++;if(selection[i]===')')level--;if(selection[i]===','&&level===0){parts.push(selection.slice(begin,i).trim());begin=i+1}}parts.push(selection.slice(begin).trim());
  const row={};for(const part of parts){if(!part||part==='*')continue;const paren=part.indexOf('(');let name=(paren<0?part:part.slice(0,paren)).split('!')[0];name=name.split(':')[0].trim();row[name]=paren<0?concrete(name):selectRow(part.slice(paren+1,part.lastIndexOf(')')))}return row;
 }
 function fallback(key){
  if(/^(items|profiles|residents|servants|receipts|Visitors|recentVisitors|preApprovedVisitors|members|familyMembers|societies|towers|blocks|flatTypes|staff|facilities|facilitiesSchedules|myBookings|bookings|payments|notices|visitors|complaints|documents|wishlist|rows|records|images|imageUrls|uploads|files|contacts|data)$/.test(key))return[rowExample(key)];
  return concrete(key)
 }
 function unwrap(n){while(n&&(ts.isAsExpression(n)||ts.isParenthesizedExpression(n)||ts.isNonNullExpression(n)||ts.isAwaitExpression(n)))n=n.expression;return n}
 function lookup(n){const symbol=checker.getSymbolAtLocation(n);if(symbol?.valueDeclaration)return symbol.valueDeclaration;const vs=variables.get(n.text)??[];return [...vs].reverse().find(x=>x.pos<n.pos)??vs[0]}
 function returnFrom(fn){if(!fn)return null;if(fn.body&&!ts.isBlock(fn.body))return fn.body;const returns=[];function walk(n){if(n!==fn&&ts.isFunctionLike(n))return;if(ts.isReturnStatement(n)&&n.expression)returns.push(n.expression);else ts.forEachChild(n,walk)}walk(fn);return returns.find(x=>ts.isObjectLiteralExpression(unwrap(x)))??returns.at(-1)}
 function ev(node,key='',env={},seen=new Set(),depth=0){
  let n=unwrap(node);if(!n||depth>18)return fallback(key);const id=n.pos+':'+key;if(seen.has(id))return fallback(key);seen=new Set(seen).add(id);
  const sub=(x,k=key,e=env)=>ev(x,k,e,seen,depth+1);
  if(ts.isStringLiteralLike(n))return n.text;
  if(ts.isNumericLiteral(n))return Number(n.text);
  if(n.kind===ts.SyntaxKind.TrueKeyword)return true;if(n.kind===ts.SyntaxKind.FalseKeyword)return false;if(n.kind===ts.SyntaxKind.NullKeyword)return null;
  if(ts.isObjectLiteralExpression(n)){
   const out={};for(const p of n.properties){if(ts.isSpreadAssignment(p)){const x=sub(p.expression,key);if(x&&!Array.isArray(x)&&typeof x==='object')Object.assign(out,x);continue}
    if(ts.isPropertyAssignment(p)){const k=p.name.getText(sf).replace(/^['"]|['"]$/g,'');out[k]=sub(p.initializer,k)}
    else if(ts.isShorthandPropertyAssignment(p))out[p.name.text]=sub(p.name,p.name.text)
   }return out
  }
  if(ts.isArrayLiteralExpression(n)){if(n.elements.length)return n.elements.slice(0,2).map(x=>sub(x,key));return /^(.*s|.*List|.*Rows)$/.test(key)?[rowExample(key)]:[]}
  if(ts.isIdentifier(n)){
   if(Object.hasOwn(env,n.text))return env[n.text];
   if(['undefined','NaN'].includes(n.text))return null;
   const d=lookup(n);
   if(d&&ts.isVariableDeclaration(d)){
    const pushed=pushes.get(d.pos);if(pushed?.length)return ts.isSpreadElement(pushed[0])?sub(pushed[0].expression,key):[sub(pushed[0],key)];
    const assigned=assignments.get(n.text);if(!d.initializer&&assigned?.length)return sub(assigned.find(a=>a.pos<currentNode.pos)?.right??assigned[0].right,key);
    if(d.initializer){let value=sub(d.initializer,key);if(value&&typeof value==='object'&&!Array.isArray(value))for(const [prop,vs]of assignments)if(prop.startsWith(n.text+'.'))value[prop.slice(n.text.length+1)]=sub(vs[0].right,prop.slice(n.text.length+1));return value}
   }
   if(d&&ts.isBindingElement(d)){let parent=d.parent;while(parent&&!ts.isVariableDeclaration(parent))parent=parent.parent;if(parent?.initializer){const v=sub(parent.initializer,key);const field=d.propertyName?.getText(sf)??d.name.getText(sf);if(v&&Object.hasOwn(v,field))return v[field];}return fallback(key);}
   return fallback(key)
  }
  if(ts.isPropertyAccessExpression(n)){
   if(ts.isIdentifier(n.expression)&&Object.hasOwn(env,n.expression.text)){const v=env[n.expression.text];if(v&&Object.hasOwn(v,n.name.text))return v[n.name.text]}
   const base=sub(n.expression,key);if(base&&typeof base==='object'&&Object.hasOwn(base,n.name.text))return base[n.name.text];
   if(n.name.text==='length')return 1;
   if(ts.isIdentifier(n.expression)&&/^(COMPLAINT_STATUS|OTP_STAGE|PAYMENT_STATUS|STATUS)$/.test(n.expression.text))return n.name.text;
   return concrete(key||n.name.text)
  }
  if(ts.isElementAccessExpression(n)){const v=sub(n.expression,key);const at=n.argumentExpression?sub(n.argumentExpression,key):0;if(v&&typeof v==='object')return v[at]??v[0]??fallback(key);return fallback(key);}
  if(ts.isConditionalExpression(n)){
   const a=unwrap(n.whenTrue),b=unwrap(n.whenFalse);
   if(ts.isObjectLiteralExpression(a))return sub(a,key);
   if(ts.isObjectLiteralExpression(b))return sub(b,key);
   if(a.kind===ts.SyntaxKind.NullKeyword)return sub(b,key);return sub(a,key)
  }
  if(ts.isBinaryExpression(n)){
   if([ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)){
    const left=sub(n.left,key);return left??sub(n.right,key)
   }
   if([ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.GreaterThanToken,ts.SyntaxKind.LessThanToken,ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind))return true;
   return /count|total|price|amount|page|limit|floor|flats/i.test(key)?1:concrete(key)
  }
  if(ts.isTemplateExpression(n))return concrete(key);
  if(ts.isPrefixUnaryExpression(n))return n.operator===ts.SyntaxKind.ExclamationToken?true:concrete(key);
  if(ts.isCallExpression(n)){
   const name=text(n.expression),args=n.arguments;
   if(name==='residentFlatTypeFields')return {flatTypeId:UUID,flatType:'2 BHK'};
   if(name==='contactParkingSlot'||name==='normalizeParkingSlot')return 'P-101';
   if(/^(String|sanitizeString|cleanText|cleanPhone|capitalizeName|mapVehicleToApp)$/.test(name))return args[0]?sub(args[0],key):concrete(key);
   if(/^(Number|parseInt|parseFloat)$/.test(name)||name.startsWith('Math.'))return /id/i.test(key)?1:/charge|amount|price/i.test(key)?1500:1;
   if(name==='JSON.stringify')return sub(args[0],key);
   if(name==='successResponse'&&!functions.has(name))return{success:true,data:sub(args[0],'payload')};
   if(/\.(eq|neq|is|not|in|contains|ilike|like|order|range|limit|gte|lte|gt|lt|or|match|filter|abortSignal)$/.test(name))return sub(n.expression.expression,key);
   if(/\.(single|maybeSingle)$/.test(name)){const v=sub(n.expression.expression,key);if(v&&v.data)return {...v,data:Array.isArray(v.data)?v.data[0]:v.data};return v;}
   if(/\.select$/.test(name)&&args[0]&&ts.isStringLiteralLike(args[0]))return {data:[selectRow(args[0].text)],count:1,error:null};

   if(/\.map$/.test(name)){
    const callback=unwrap(args[0]);
    if(callback&&(ts.isArrowFunction(callback)||ts.isFunctionExpression(callback))){const expr=returnFrom(callback);if(expr){const input=sub(n.expression.expression,key),row=Array.isArray(input)?input[0]:input?.data?.[0];const binds={...env};if(callback.parameters[0]&&ts.isIdentifier(callback.parameters[0].name)&&row&&typeof row==='object')binds[callback.parameters[0].name.text]=row;return[sub(expr,key,binds)]}}
    if(callback&&ts.isIdentifier(callback)&&functions.has(callback.text)){const f=functions.get(callback.text),ret=returnFrom(f);if(ret)return[sub(ret,key)]}
    return[rowExample(key)]
   }
   if(/\.filter$|\.slice$|\.sort$/.test(name))return sub(n.expression.expression,key);
   if(name==='asPayload'||name==='toCamel')return sub(args[0],key);
   if(/(jsonOk|jsonSuccess|respond|buildSuccess|successResponse)$/.test(name)&&functions.has(name)){
    const fn=functions.get(name);const binds={...env};fn.parameters.forEach((p,i)=>{if(ts.isIdentifier(p.name))binds[p.name.text]=args[i]?sub(args[i],p.name.text):concrete(p.name.text)});return sub(returnFrom(fn),key,binds)
   }
   if(functions.has(name)&&/format|buildProfile|build.*Response|formatSocietyConfiguration|parkingCounts/.test(name))return sub(returnFrom(functions.get(name)),key);
   if(/\.toISOString$/.test(name))return '2026-11-11T10:00:00+05:30';
   if(/\.toLowerCase$|\.toUpperCase$|\.trim$|\.join$/.test(name))return concrete(key);
   if(name==='Array.isArray')return false;
   return fallback(key)
  }
  if(ts.isNewExpression(n)&&text(n.expression)==='Response'){
   const first=n.arguments?.[0];if(first&&ts.isCallExpression(unwrap(first))&&text(unwrap(first).expression)==='JSON.stringify')return sub(unwrap(first).arguments[0],key);
   if(api!=='generate-payment-receipt')return null;
   return {contentType:'application/pdf',fileName:'receipt.pdf',body:'<BINARY_PDF_BYTES>'}
  }
  return fallback(key)
 }
 function context(n){let fn='HANDLER',labels=[];for(let p=n.parent;p;p=p.parent){if(ts.isFunctionDeclaration(p)&&p.name){fn=p.name.text;break}if(ts.isIfStatement(p)){const c=text(p.expression);if(/action|operation|stage|list|responseFormat/i.test(c))labels.push(c.slice(0,160))}if(ts.isCaseClause(p))labels.push(text(p.expression));}return {fn,branch:labels.reverse().join(' / ')}}
 function returns(n){
  if(ts.isReturnStatement(n)&&n.expression){const expr=unwrap(n.expression);if(ts.isCallExpression(expr)||ts.isNewExpression(expr)){
   const name=text(expr.expression);if(/successResponse|buildSuccess|respond$|jsonOk|jsonSuccess|^Response$/.test(name)){
    const ctx=context(n);let options=false;for(let parent=n.parent;parent;parent=parent.parent)if(ts.isIfStatement(parent)&&/req\.method.*OPTIONS/.test(text(parent.expression)))options=true;if(options){ts.forEachChild(n,returns);return;}if(!/^(respond|buildSuccess|jsonOk|jsonSuccess|successResponse|fail|failResponse|notModifiedResponse|buildError|jsonError|errorResponse)$/.test(ctx.fn)){
     currentNode=n;rowBusy.clear();try{const value=ev(expr,'response');if(value&&typeof value==='object')candidates.push({...ctx,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,value})}catch(e){unresolved.add('exception:'+e.message)}
    }
   }
  }}ts.forEachChild(n,returns)
 }
 returns(sf);
 // Exact AST response expressions are fully expanded into illustrative JSON values.
 const unique=[];for(const c of candidates){if(!unique.some(x=>JSON.stringify(x.value)===JSON.stringify(c.value)&&x.fn===c.fn&&x.branch===c.branch))unique.push(c)}
 const shapes=[];
 function shapeScan(n){if(ts.isObjectLiteralExpression(n)&&n.properties.length>=3){let parent=n.parent;while(parent&&(ts.isAsExpression(parent)||ts.isParenthesizedExpression(parent)))parent=parent.parent;let owner='';let kind='';
  if(ts.isArrowFunction(parent)){owner=context(parent).fn;kind='callback'}
  if(ts.isVariableDeclaration(parent)){owner=parent.name.getText(sf);kind='variable'}
  if(ts.isReturnStatement(parent)){owner=context(parent).fn;kind='return'}
  if(ts.isCallExpression(parent)&&/\.push$/.test(text(parent.expression))){owner=text(parent.expression);kind='push'}
  if(ts.isBinaryExpression(parent)&&parent.right===n){owner=text(parent.left);kind='assignment'}
  if(kind){currentNode=n;rowBusy.clear();try{shapes.push({owner,kind,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,value:ev(n,'item')})}catch{}}
 }ts.forEachChild(n,shapeScan)}shapeScan(sf);
 result[api]={responses:unique,shapes,unresolved:[...unresolved]};
}
fs.writeFileSync('artifacts/api-workbook-audit/materialized-responses.json',JSON.stringify(result,null,2));
console.log(Object.entries(result).map(([n,c])=>n+': '+c.responses.length+' examples; '+c.unresolved.join(', ')).join('\n'));
