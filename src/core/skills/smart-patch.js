import * as fs from "fs";
import * as path from "path";
export class SmartPatchSkill {
    /**
     * Skill de substituição cirúrgica de trechos de código via blocos diff unificados
     */
    static applyPatch(filePath, targetContent, replacementContent) {
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                filePath: absolutePath,
                linesModified: 0,
                message: `Arquivo não encontrado para aplicar o patch: ${absolutePath}`,
            };
        }
        const fileText = fs.readFileSync(absolutePath, "utf-8");
        if (!fileText.includes(targetContent)) {
            return {
                success: false,
                filePath: absolutePath,
                linesModified: 0,
                message: `Trecho original não encontrado no arquivo. Verifique indentação e quebras de linha.`,
            };
        }
        const newText = fileText.replace(targetContent, replacementContent);
        fs.writeFileSync(absolutePath, newText, "utf-8");
        const linesModified = replacementContent.split("\n").length;
        return {
            success: true,
            filePath: absolutePath,
            linesModified,
            message: `Patch cirúrgico aplicado com sucesso em ${path.basename(filePath)}.`,
        };
    }
}
