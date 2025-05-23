"use client"

import { UserDetailContext } from '@/context/UserDetailContext';
import { supabase } from '@/services/supabaseClient';
import React, { useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function Provider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
    
  useEffect(() => {
    // Check for an existing session first
    const initializeAuth = async () => {
      try {
        // Listen for auth state changes
        const { data: authListener } = supabase.auth.onAuthStateChange(
          async (event, session) => {            console.log('Auth event:', event);            
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
              console.log('Processing sign-in event with user data');
              await createOrFetchUser(session?.user);
              
              // Broadcast auth update event to all components
              if (typeof window !== 'undefined') {
                const authEvent = new CustomEvent('supabase-auth-update', { 
                  detail: { action: 'signed_in', timestamp: new Date().getTime() } 
                });
                window.dispatchEvent(authEvent);
                console.log('Auth update event dispatched from provider');
              }
                // Redirect to homepage after sign-in if needed
              const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
              console.log('Current path after sign-in:', currentPath);
              
              // If on auth page or other non-home pages, redirect to home
              if (typeof window !== 'undefined' && currentPath.includes('/auth')) {
                console.log('Redirecting from auth page to homepage');
                router.push('/');
              }
            } else if (event === 'SIGNED_OUT') {
              console.log('User signed out');
              setUser(null);
              // Only redirect to auth if not already on homepage
              const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
              if (currentPath !== '/' && currentPath !== '') {
                router.push('/auth');
              }
            } else if (event === 'USER_UPDATED') {
              // Handle user profile updates if needed
              console.log('User data updated');
              await createOrFetchUser(session?.user);
            }
          }
        );
          // Check for an existing session
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionData?.session?.user) {
          console.log('Found existing session, setting up user data');
          await createOrFetchUser(sessionData.session.user);
        } else {
          console.log('No session found');
          setIsLoading(false);
          // Don't redirect from homepage, let user browse as non-authenticated
          // Protected routes are handled by Navbar component
        }
        
        return () => {
          // Clean up the listener when component unmounts
          if (authListener?.subscription?.unsubscribe) {
            authListener.subscription.unsubscribe();
          }
        };
      } catch (err) {
        console.error("Auth initialization error:", err);
        setError(err.message);
        setIsLoading(false);
      }
    };
    
    initializeAuth();
  }, [router]);
      const createOrFetchUser = async (authUser) => {
    if (!authUser) {
      console.log('No auth user provided');
      return;
    }
    
    console.log('Processing user:', authUser.email);
      
    try {
      // Get admin emails for direct comparison
      const ADMIN_EMAILS = [
        '950321104040@gracecoe.org', 
        'principal@gracecoe.org',
        'placement.officer@gracecoe.org',
        'dean@gracecoe.org',
        'tech.admin@gracecoe.org'
      ];
      
      // Check if this is an admin by email
      const isAdminUser = ADMIN_EMAILS.includes(authUser.email.toLowerCase());
      console.log('Admin by email?', isAdminUser);
      
      // Check for admin status in user metadata
      const isAdminInMetadata = authUser.user_metadata?.is_admin === true;
      console.log('Admin in metadata?', isAdminInMetadata);
      
      // First check if user exists in our Users table
      const { data: existingUsers, error: fetchError } = await supabase
        .from('Users')
        .select('*')
        .eq('email', authUser.email);
        
      if (fetchError) { 
        console.error("Error fetching user:", fetchError.message);
        setError(fetchError.message);
        setIsLoading(false);
        return;
      }
        
      // Check if a user exists and use the first one if multiple
      const existingUser = existingUsers && existingUsers.length > 0 ? existingUsers[0] : null;
      
      console.log('User data check:', existingUser ? 'Found existing user' : 'Creating new user');
      
      // Determine final admin status from all sources
      const finalAdminStatus = isAdminUser || isAdminInMetadata || (existingUser?.is_admin === true);

      if (!existingUser) {
        // Create new user logic
        let userName = '';
        let userPicture = null;
        
        if (authUser.user_metadata?.name) {
          userName = authUser.user_metadata.name;
        } else if (authUser.user_metadata?.full_name) {
          userName = authUser.user_metadata.full_name;
        } else {
          // Use email as fallback if no name is available
          userName = authUser.email.split('@')[0];
        }

        // Get profile picture if available
        userPicture = authUser.user_metadata?.picture || 
                     authUser.user_metadata?.avatar_url || 
                     null;
        
        // Basic user data with admin flag
        const userData = {
          name: userName,
          email: authUser.email,
          picture: userPicture,
          is_admin: finalAdminStatus,
          created_at: new Date().toISOString()
        };
        
        // Insert new user into the Users table
        const { data, error } = await supabase
          .from("Users")
          .insert([userData])
          .select();
            
        if (error) {
          console.error("Data insertion error:", error.message);
          setError(error.message);
        } else {
          console.log('New User created:', data);          // Add the admin flag to the user object in memory
          const newUser = data[0];
          newUser.is_admin_computed = finalAdminStatus;
          setUser(newUser);
          
          // Broadcast user update for navbar and other components
          if (typeof window !== 'undefined') {
            const userUpdateEvent = new CustomEvent('supabase-auth-update', { 
              detail: { action: 'user_created', user: newUser, timestamp: new Date().getTime() } 
            });
            window.dispatchEvent(userUpdateEvent);
            console.log('User creation event dispatched');
          }
        }
      } else {
        // User exists, update admin status if needed
        if (existingUser.is_admin !== finalAdminStatus) {
          try {
            const { error: updateError } = await supabase
              .from('Users')
              .update({ is_admin: finalAdminStatus })
              .eq('id', existingUser.id);
              
            if (updateError && !updateError.message.includes('column "is_admin" does not exist')) {
              console.error("Error updating admin status:", updateError.message);
            }
          } catch (err) {
            console.error("Failed to update admin status:", err);
          }
        }
          // User exists, add computed admin status to the object
        existingUser.is_admin_computed = finalAdminStatus;
        setUser(existingUser);
        
        // Broadcast existing user update for navbar and other components
        if (typeof window !== 'undefined') {
          const userUpdateEvent = new CustomEvent('supabase-auth-update', { 
            detail: { action: 'user_fetched', user: existingUser, timestamp: new Date().getTime() } 
          });
          window.dispatchEvent(userUpdateEvent);
          console.log('Existing user update event dispatched');
        }
      }
    } catch (error) {
      console.error("Error processing user:", error.message);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  // If there's an error in authentication, render a simple error state
  // instead of breaking the whole app
  if (error && !isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <div className="bg-red-50 border border-red-200 rounded-md p-4 max-w-md w-full">
          <h2 className="text-xl font-semibold text-red-700 mb-2">Authentication Error</h2>
          <p className="text-red-600">{error}</p>
          <button 
            onClick={async () => {
              setError(null);
              try {
                setIsLoading(true);
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData?.session?.user) {
                  await createOrFetchUser(sessionData.session.user);
                } else {
                  setIsLoading(false);
                  router.push('/auth');
                }
              } catch (err) {
                console.error("Retry error:", err);
                setError(err.message);
                setIsLoading(false);
              }
            }}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
          <button 
            onClick={() => router.push('/auth')}
            className="mt-4 ml-2 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }
    
  return (
    <UserDetailContext.Provider value={{user, setUser, isLoading, error}}>
      {children}
    </UserDetailContext.Provider>
  )
}

export default Provider;

export const useUser = () => {
  const context = useContext(UserDetailContext);
  if (!context) {
    throw new Error('useUser must be used within a UserDetailContext.Provider');
  }
  return context;
};
