import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Role } from "src/enums/roles.enum";

@Injectable()
export class IsAdminGuard implements CanActivate{
    constructor(
        private jwtService: JwtService
    ){}
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest()
        const token = this.getToken(request['headers'])
        if(!token) throw new UnauthorizedException('permition denied')

        try{
            const payload = await this.jwtService.verify(token)
            if(payload.role !== Role.ADMIN) throw new UnauthorizedException('permition denied')
            request.role = payload.role

            return true
        }catch(e){
            throw new UnauthorizedException('permition denied')
        }
    }

    getToken(headers){
        if(!headers['authorization']) return null
        const [type, token] = headers['authorization'].split(' ')
        return type === 'Bearer' ? token : null
    }
}