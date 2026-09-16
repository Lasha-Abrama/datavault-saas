import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-google-oauth2";

export class GoogleStrategy extends PassportStrategy(Strategy, 'google'){
    constructor(){
        super({
            clientID: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            callbackURL: process.env.GOOGLE_CALLBACK_URL!,
            scope: ['email', 'profile']
        })
    }

    async validate(accessToken, refreshToken, profile, done) {
        const data = {
            email: profile.email,
            fullName: profile.displayName,
            avatar: profile.picture
        }
        done(null, data)
    }
}