// 광고주 로고 공개 주소 (저장소 logos 는 공개 읽기 버킷)
export const logoUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/logos/${path}`;
