const ts=require('/private/tmp/ssp-api-workbook-audit/node_modules/typescript');
const fs=require('fs'),path=require('path');
const root='supabase/functions',out={};
const printer=ts.createPrinter({removeComments:true});
for(const name of fs.readdirSync(root).sort()){
 const file=path.join(root,name,'index.ts');if(!fs.existsSync(file)||name.startsWith('_'))continue;
 const source=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const clean=printer.printFile(sf);fs.mkdirSync('artifacts/api-workbook-audit/source',{recursive:true});fs.writeFileSync('artifacts/api-workbook-audit/source/'+name+'.ts',clean);
 const contract={name,file,interfaces:{},types:{},requestAccesses:[],query:[],destructures:[],validations:[],enums:{},response:[],tables:[],methods:[],auth:[],errors:[],returnObjects:[],cases:[],form:[],collectionObjects:[],sharedSources:[]};
 const text=n=>n.getText(sf);
 function typeShape(n,depth=0){if(!n)return'unknown';if(ts.isTypeReferenceNode(n)&&['Array','ReadonlyArray'].includes(n.typeName.getText(sf))&&n.typeArguments?.[0])return[typeShape(n.typeArguments[0],depth+1)];if(depth>7)return text(n);if(ts.isTypeLiteralNode(n))return Object.fromEntries(n.members.filter(ts.isPropertySignature).map(p=>[p.name.getText(sf)+(p.questionToken?'?':''),typeShape(p.type,depth+1)]));if(ts.isArrayTypeNode(n))return[typeShape(n.elementType,depth+1)];if(ts.isUnionTypeNode(n))return{union:n.types.map(x=>typeShape(x,depth+1))};return text(n)}
 function visit(n){
 if(ts.isCaseClause(n)&&ts.isStringLiteral(n.expression))contract.cases.push(n.expression.text);
 if(ts.isReturnStatement(n)&&n.expression&&ts.isObjectLiteralExpression(n.expression)){let parent=n.parent;while(parent&&!ts.isFunctionLike(parent))parent=parent.parent;contract.returnObjects.push({function:parent?.name?.getText(sf)??"callback",value:text(n.expression).slice(0,6000)});}
 if(ts.isInterfaceDeclaration(n))contract.interfaces[n.name.text]=Object.fromEntries(n.members.filter(ts.isPropertySignature).map(p=>[p.name.getText(sf)+(p.questionToken?'?':''),typeShape(p.type)]));
 if(ts.isTypeAliasDeclaration(n))contract.types[n.name.text]=typeShape(n.type);
 if(ts.isVariableDeclaration(n)&&n.initializer){
  if(ts.isObjectBindingPattern(n.name))contract.destructures.push({fields:n.name.elements.map(e=>text(e)),from:text(n.initializer).slice(0,130)});
  if(ts.isIdentifier(n.name)){
   let init=n.initializer;if(ts.isAsExpression(init))init=init.expression;
   if(ts.isArrayLiteralExpression(init)&&init.elements.every(x=>ts.isStringLiteral(x)||ts.isNumericLiteral(x)))contract.enums[n.name.text]=init.elements.map(x=>x.text);
   if(ts.isNewExpression(init)&&text(init.expression)==='Set'&&init.arguments?.[0]&&ts.isArrayLiteralExpression(init.arguments[0])&&init.arguments[0].elements.every(ts.isStringLiteral))contract.enums[n.name.text]=init.arguments[0].elements.map(x=>x.text);
  }
 }
 if(ts.isPropertyAccessExpression(n)&&/^(body|reqBody|requestObj|requestData|input|params|payload|data|req)\./.test(text(n))&&text(n).length<120)contract.requestAccesses.push(text(n));
 if(ts.isCallExpression(n)){
  const call=text(n.expression),args=n.arguments.map(text);
  if(/(results|members|bookings|facilities|items|notices|created|records)\.push$/i.test(call)&&n.arguments[0]&&ts.isObjectLiteralExpression(n.arguments[0]))contract.collectionObjects.push({collection:call,value:text(n.arguments[0]).slice(0,7000)});
  let ancestor=n.parent,returned=false,responseConstructor=false;while(ancestor&&!ts.isStatement(ancestor)){if(ts.isNewExpression(ancestor)&&text(ancestor.expression)==='Response')responseConstructor=true;ancestor=ancestor.parent;}returned=ancestor&&ts.isReturnStatement(ancestor);
  if(returned&&!/error|fail/i.test(call)&&call!=='JSON.stringify'){for(const argument of n.arguments){let obj=argument;if(ts.isCallExpression(obj))obj=obj.arguments[0];if(obj&&ts.isObjectLiteralExpression(obj))contract.response.push(text(obj).slice(0,7000));}}
  if(/formData\.get$/.test(call)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))contract.form.push(n.arguments[0].text);
  if(returned&&/successResponse|buildSuccess/.test(call)){let a=n.arguments[call.endsWith('buildSuccess')?1:0];if(a&&ts.isCallExpression(a))a=a.arguments[0];if(a&&ts.isObjectLiteralExpression(a))contract.response.push(text(a).slice(0,7000));}
  if(/searchParams\.get$/.test(call)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))contract.query.push(n.arguments[0].text);
  if(/validateRequired|validateFields|validateRequiredFields|validateInput|requireFields/.test(call))contract.validations.push(text(n).slice(0,900));
  if(call.endsWith('.from')&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))contract.tables.push(n.arguments[0].text);
  if((returned||responseConstructor)&&/successResponse|respond$|buildSuccess|JSON.stringify|errorResponse|fail$/.test(call)&&n.arguments[0]&&ts.isObjectLiteralExpression(n.arguments[0]))contract.response.push(text(n.arguments[0]).slice(0,2500));
 }
 if(ts.isStringLiteral(n)){
  if(/^(GET|POST|PUT|PATCH|DELETE)$/.test(n.text)&&/method/.test(text(n.parent)))contract.methods.push(n.text);
  if(/required|mandatory|must be|only .*can|only .*allowed/i.test(n.text)&&n.text.length<600)contract.errors.push(n.text);
 }
 ts.forEachChild(n,visit);
 }
 visit(sf);
 for(const statement of sf.statements){
  if(!ts.isImportDeclaration(statement)||!statement.moduleSpecifier.text.startsWith('.'))continue;
  const sharedPath=path.resolve(path.dirname(file),statement.moduleSpecifier.text);if(!fs.existsSync(sharedPath))continue;
  contract.sharedSources.push(path.relative(process.cwd(),sharedPath));
  const imported=statement.importClause?.namedBindings;if(!imported||!ts.isNamedImports(imported))continue;
  const depText=fs.readFileSync(sharedPath,'utf8'),depSf=ts.createSourceFile(sharedPath,depText,ts.ScriptTarget.Latest,true);
  for(const specifier of imported.elements){const original=specifier.propertyName?.text??specifier.name.text,local=specifier.name.text;
   const declaration=depSf.statements.find(s=>(ts.isInterfaceDeclaration(s)||ts.isTypeAliasDeclaration(s))&&s.name.text===original);
   if(declaration){const isolated=ts.createSourceFile('type.ts',printer.printNode(ts.EmitHint.Unspecified,declaration,depSf),ts.ScriptTarget.Latest,true);let dep=isolated.statements[0];
    const txt=n=>n.getText(isolated);function shape(n){if(!n)return'unknown';if(ts.isTypeLiteralNode(n))return Object.fromEntries(n.members.filter(ts.isPropertySignature).map(p=>[txt(p.name)+(p.questionToken?'?':''),shape(p.type)]));if(ts.isArrayTypeNode(n))return[shape(n.elementType)];if(ts.isUnionTypeNode(n))return{union:n.types.map(shape)};return txt(n)}
    if(ts.isInterfaceDeclaration(dep))contract.interfaces[local]??=Object.fromEntries(dep.members.filter(ts.isPropertySignature).map(p=>[txt(p.name)+(p.questionToken?'?':''),shape(p.type)]));else contract.types[local]??=shape(dep.type);
   }
  }
 }

 for(const key of ['requestAccesses','query','tables','methods','errors'])contract[key]=[...new Set(contract[key])];
 if(/requireAuth\(/.test(clean))contract.auth.push('requireAuth middleware');
 if(/jwtVerify\(|\bverify\(token|auth\.getUser\(/.test(clean))contract.auth.push('JWT verification');
 if(/get\(["']Authorization["']\)|get\(["']authorization["']\)/.test(clean))contract.auth.push('Authorization header inspected');
 if(/authorizeAdmin\(/.test(clean))contract.auth.push('Society admin credentials in body');
 if(/x-razorpay-signature/.test(clean))contract.auth.push('Razorpay signature');
 contract.lines=clean.split('\n').length;
 out[name]=contract;
}
fs.writeFileSync('artifacts/api-workbook-audit/contracts.json',JSON.stringify(out,null,2));
for(const [name,c] of Object.entries(out)){
 const types=Object.keys(c.interfaces).filter(n=>/Request|Input|Body|Payload/.test(n)&&!/^Authenticated/.test(n));
 console.log('\n'+name+' ['+c.methods+'] auth='+c.auth.join('; '));
 for(const n of types)console.log(n+': '+JSON.stringify(c.interfaces[n]));
 if(!types.length)console.log('BODY '+c.destructures.filter(d=>/body|request|json|input|payload|params/.test(d.from)).map(d=>d.fields.join(',')).join('; '));
 console.log('QUERY '+c.query.join(',')+' CHECKS '+c.errors.join(' | ').slice(0,600));
}
