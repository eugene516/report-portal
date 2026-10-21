import { NextResponse, type NextRequest } from "next/server";
import { supabaseForStaff } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await supabaseForStaff();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
