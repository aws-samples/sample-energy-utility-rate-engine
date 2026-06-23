import { signIn, signOut, getCurrentUser, fetchAuthSession, updatePassword } from 'aws-amplify/auth';

export interface User {
  username: string;
  email: string;
  groups: string[];
}

export interface LoginParams {
  username: string; // Can be email or username, but typically email for this app
  password: string;
}

export interface ChangePasswordParams {
  oldPassword: string;
  newPassword: string;
}

export class AuthService {
  /**
   * Sign in with username and password
   */
  public static async login(params: LoginParams): Promise<User> {
    const { username, password } = params;

    try {
      const { isSignedIn } = await signIn({ username, password });

      if (!isSignedIn) {
        throw new Error('Sign in was not successful');
      }

      // Get the current user details
      const currentUser = await getCurrentUser();

      // Get the auth session to extract groups from the token
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;

      // Extract user groups from the JWT token payload
      const groups = (idToken?.payload['cognito:groups'] as string[]) || [];
      const email = (idToken?.payload.email as string) || username;

      return {
        username: currentUser.username,
        email,
        groups,
      };
    } catch (error) {
      console.error('Error signing in:', error);
      throw new Error(error instanceof Error ? error.message : 'An error occurred during login');
    }
  }

  /**
   * Sign out the current user
   */
  public static async logout(): Promise<void> {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
      throw new Error(error instanceof Error ? error.message : 'An error occurred during logout');
    }
  }

  /**
   * Get the currently authenticated user
   */
  public static async getCurrentUser(): Promise<User | null> {
    try {
      const currentUser = await getCurrentUser();

      // Get the auth session to extract groups from the token
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;

      // Extract user groups from the JWT token payload
      const groups = (idToken?.payload['cognito:groups'] as string[]) || [];
      const email = (idToken?.payload.email as string) || currentUser.username;

      return {
        username: currentUser.username,
        email,
        groups,
      };
    } catch {
      // User is not authenticated
      return null;
    }
  }

  /**
   * Change the current user's password
   */
  public static async changePassword(params: ChangePasswordParams): Promise<void> {
    const { oldPassword, newPassword } = params;

    try {
      await updatePassword({ oldPassword, newPassword });
    } catch (error) {
      console.error('Error changing password:', error);
      throw new Error(error instanceof Error ? error.message : 'An error occurred while changing password');
    }
  }

  /**
   * Check if the user has the required group
   */
  public static async hasGroup(group: string): Promise<boolean> {
    try {
      const user = await this.getCurrentUser();
      return user?.groups.includes(group) || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if the user is an administrator
   */
  public static async isAdmin(): Promise<boolean> {
    return this.hasGroup('Administrators');
  }

  /**
   * Check if the user has at least read access
   */
  public static async hasReadAccess(): Promise<boolean> {
    const isAdmin = await this.isAdmin();
    const isReadOnly = await this.hasGroup('ReadOnly');
    return isAdmin || isReadOnly;
  }

  /**
   * Check if the user has write access
   */
  public static async hasWriteAccess(): Promise<boolean> {
    return this.isAdmin();
  }
}