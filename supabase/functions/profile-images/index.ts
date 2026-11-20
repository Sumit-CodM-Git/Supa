import {createClient} from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {requireAuth} from "../_shared/auth.ts";
import {corsHeaders} from "../_shared/response.ts";
import {handleProfileImages} from "../_shared/profile-images.ts";

const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
Deno.serve(requireAuth(async(req,auth)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  return await handleProfileImages(req,auth.user.id,client);
}));
