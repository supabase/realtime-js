This is an example program for Supabase Realtime Presence APIs. 
User get authenticated using Supabase Auth API. Once Logged-in you can see which users are 'present' and viewing the page. 

- Frontend:
  - Next.js.
  - [Supabase.js 2.0.1 (realtime presence support)](https://supabase.io/docs/library/getting-started) 
- Backend:
  - [app.supabase.io](https://app.supabase.io/): hosted postgres database with realtime support.



## Getting Started

### 1. Create new project

Sign up to Supabase - [https://app.supabase.io](https://app.supabase.io) and create a new project. Wait for your database to start.

### 2. Run "User Management Starter" Quickstart

This will create user tables and profile tables for user management. 

### 3. Get the URL and Key

Go to the Project Settings (the cog icon), open the API tab, and find your API URL and `anon` key, you'll need these in the next step.

The `anon` key is your client-side API key. It allows "anonymous access" to your database, until the user has logged in. Once they have logged in, the keys will switch to the user's own login token. 

![image](https://user-images.githubusercontent.com/10214025/88916245-528c2680-d298-11ea-8a71-708f93e1ce4f.png)


### 4. Pull this example git repository

 `git clone <<this repository url>> `

### 5. Create a .env.local file

Create a .env.local file and add following re
NEXT_PUBLIC_SUPABASE_URL=<<insert-your-db-url-here>>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<<insert-your-anon-key-here>>

### 5. Now run the development server!
Now run 
First, run the development server:

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.


## How to Test?

You will see auth login/signup screen. 

Signup if you haven't and then login. 

You will see the current list of users on the screen.

You can open multiple windows and login using different logins credentials. 
You will see the list contains all the users from the window. 

## Deployment
Since this is next.js application, simplest method to  deploy this repository is on Vercel. 

## Conclusion/Next Steps
  - Need to implement Profile page
  - Need to implement ability to upload User Avatars
  - Need ability to read user avatar from social media.
