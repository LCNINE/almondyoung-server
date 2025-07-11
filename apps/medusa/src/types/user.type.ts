export interface User {
  id: string;
  isEmailVerified: boolean;
  username: string;
  profile: {
    phone_number: string;
    address: string;
    birth_date: string;
    profile_image_url: string;
    created_at: string;
    updated_at: string;
  };
}
