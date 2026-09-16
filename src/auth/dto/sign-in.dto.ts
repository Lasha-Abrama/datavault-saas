import { IsEmail, IsNotEmpty, IsString, Length, Min } from "class-validator";

export class SignInDto{
    @IsNotEmpty()
    @IsEmail()
    email: string

    @IsNotEmpty()
    @IsString()
    @Length(6, 20)
    password: string
}