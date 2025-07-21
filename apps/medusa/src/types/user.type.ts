export interface User {
  id: string;
  email: string;
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
  roles: {
    role: {
      id: string;
      name: string;
    };
    scopes: {
      scope_name: string;
      description: string;
    }[];
  }[];
}

export interface UserDTO {
  email: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}

export interface UserRole {
  userId: string;
  roles: {
    role: {
      id: string;
      name: string;
    };
    scopes: {
      scope_name: string;
      description: string;
    }[];
  }[];
}

// user-service 응답 타입
export interface UserServiceResponse<T> {
  success: boolean;
  data: T;
}
