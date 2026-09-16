import { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Observable } from "rxjs";


export class GoogleOauthGuard extends AuthGuard('google'){
    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
        const request = context.switchToHttp().getRequest();

        if(request.query.error) {
            return true
        }
        return super.canActivate(context) as boolean;
    }
}