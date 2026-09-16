import { IsMongoId } from "class-validator";


export class IsValidMongoDBId{
    
    @IsMongoId()
    id: string
}